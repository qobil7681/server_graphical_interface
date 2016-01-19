/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

(function() {
    "use strict";

    /*
     * Some notes on the create fields.
     *
     * Namespaces should be created first, as they must exist before objects in
     * them are created.
     *
     * Services should be created before pods (or replication controllers that
     * make pods. This is because of the environment variables that pods get
     * when they want to access a service.
     *
     * Create pods before replication controllers ... corner case, but keeps
     * things sane.
     */

    var KUBE = "/api/v1";
    var OPENSHIFT = "/oapi/v1";
    var DEFAULT = { api: KUBE, create: 0 };
    var SCHEMA = flatSchema([
        { kind: "Group", type: "groups", api: OPENSHIFT, global: true },
        { kind: "Image", type: "images", api: OPENSHIFT, global: true },
        { kind: "ImageStream", type: "imagestreams", api: OPENSHIFT },
        { kind: "ImageStreamImage", type: "imagestreamimages", api: OPENSHIFT },
        { kind: "Namespace", type: "namespaces", api: KUBE, global: true, create: -100 },
        { kind: "Node", type: "nodes", api: KUBE, global: true },
        { kind: "Pod", type: "pods", api: KUBE, create: -20 },
        { kind: "Project", type: "projects", api: OPENSHIFT, global: true, create: -90 },
        { kind: "ReplicationController", type: "replicationcontrollers", api: KUBE, create: -60 },
        { kind: "Service", type: "services", api: KUBE, create: -80 },
        { kind: "User", type: "users", api: OPENSHIFT, global: true },
    ]);

    function debug() {
        if (window.debugging == "all" || window.debugging == "kube")
            console.debug.apply(console, arguments);
    }

    function hash(str) {
        var h, i, chr, len;
        if (str.length === 0)
            return 0;
        for (h = 0, i = 0, len = str.length; i < len; i++) {
            chr = str.charCodeAt(i);
            h = ((h << 5) - h) + chr;
            h |= 0; // Convert to 32bit integer
        }
        return Math.abs(h);
    }

    function search(arr, val) {
        var low = 0;
        var high = arr.length - 1;
        var mid, v;

        while (low <= high) {
            mid = (low + high) / 2 | 0;
            v = arr[mid];
            if (v < val)
                low = mid + 1;
            else if (v > val)
                high = mid - 1;
            else
                return mid; /* key found */
        }
        return low;
    }

    /**
     * HashIndex
     *
     * A probablisting hash index, where items are added with
     * various keys, and probable matches are returned. Similar
     * to bloom filters, false positives are possible, but never
     * false negatives.
     */
    function HashIndex(size) {
        var self = this;
        var array = [];

        self.add = function add(keys, value) {
            var i, j, p, x, length = keys.length;
            for (j = 0; j < length; j++) {
                i = hash("" + keys[j]) % size;
                p = array[i];
                if (p === undefined)
                    p = array[i] = [];
                x = search(p, value);
                if (p[x] != value)
                    p.splice(x, 0, value);
            }
        };

        self.get = function get(key) {
            var p = array[hash("" + key) % size];
            if (!p)
                return [];
            return p.slice();
        };

        self.all = function all(keys) {
            var i, j, p, result, n;
            var rl, rv, pv, ri, px;

            for (j = 0, n = keys.length; j < n; j++) {
                i = hash("" + keys[j]) % size;
                p = array[i];

                /* No match for this key, short cut out */
                if (!p) {
                    result = [];
                    break;
                }

                /* First key */
                if (!result) {
                    result = p.slice();

                /* Calculate intersection */
                } else {
                    for (ri = 0, px = 0, rl = result.length; ri < rl; ) {
                        rv = result[ri];
                        pv = p[ri + px];
                        if (pv < rv) {
                            px += 1;
                        } else if (rv !== pv) {
                            result.splice(ri, 1);
                            rl -= 1;
                        } else {
                            ri += 1;
                        }
                    }
                }
            }

            return result || [];
        };
    }

    /*
     * A WeakMap implementation
     *
     * This works on ES5 browsers, with the caveat that the mapped
     * items are discoverable with enough work.
     *
     * To be clear, the principal use of a WeakMap is to associate
     * an value with an object, the object is the key. And then have
     * that value go away when the object does. This is very, very
     * similar to properties.
     *
     * The main difference is that any assigned values are not
     * garbage collected if the *weakmap* itself is collected,
     * and of course one can actually access the non-enumerable
     * property that makes this work.
     */

    var weak_property = Math.random().toString(36).slice(2);
    var local_seed = 1;

    function SimpleWeakMap() {
        var local_property = "weakmap" + local_seed;
        local_seed += 1;

        var self = this;

        self.delete = function delete_(obj) {
            var x, map = obj[weak_property];
            if (map)
                delete map[local_property];
        };

        self.has = function has(obj) {
            var map = obj[weak_property];
            return (map && local_property in map);
        };

        self.get = function has(obj) {
            var map = obj[weak_property];
            if (!map)
                return undefined;
            return map[local_property];
        };

        self.set = function set(obj, value) {
            var map = obj[weak_property];
            if (!map) {
                map = function WeakMapData() { };
                Object.defineProperty(obj, weak_property, {
                    enumerable: false, configurable: false,
                    writable: false, value: map,
                });
            }

            map[local_property] = value;
        };
    }

    function flatSchema(items) {
        var i, len, ret = { "": DEFAULT };
        for (i = 0, len = items.length; i < len; i++) {
            ret[items[i].type] = items[i];
            ret[items[i].kind] = items[i];
        }
        return ret;
    }

    /*
     * Accepts:
     *  1. an object
     *  2. an involved object
     *  2. a path string
     *  3. type/kind, name, namespace
     */
    function resourcePath(args) {
        var one = args[0];
        if (one && typeof one === "object") {
            if (one.metadata) {
                /* An object with a link */
                if (one.metadata.selfLink)
                    return one.metadata.selfLink;

                /* Pull out the arguments */
                args = [ one.kind, one.metadata.name, one.metadata.namespace ];
            } else if (one.name && one.kind) {
                /* An involved object */
                args = [ one.kind, one.name, one.namespace ];
            }


        /* Already a path */
        } else if (one && one[0] == '/') {
            return one;
        }

        /*
         * Combine into a path.
         *
         * Kubernetes names and namespaces are quite limited in their contents
         * and do not need escaping to be used in a URI path.
         */
        var schema = SCHEMA[args[0]] || SCHEMA[""];
        var path = schema.api;
        if (!schema.global && args[2])
            path += "/namespaces/" + args[2];
        path += "/" + schema.type;
        if (args[1])
            path += "/" + args[1];
        return path;
    }

    /*
     * Angular definitions start here
     */

    angular.module("kubeClient", [])

    /**
     * KUBE_SCHEMA
     *
     * A dict of schema information. The keys are both object types
     * and resource kinds. The values are objects with the following
     * properties:
     *
     *  schema.kind    The object kind
     *  schema.type    The resource type (ie: used in urls)
     *  schema.api     The api endpoint to use
     *  schema.global  Set to true if resource is not namespaced.
     */

    .value("KUBE_SCHEMA", SCHEMA)

    /**
     * kubeLoader
     *
     * Loads kubernetes objects either by watching them or loading
     * objects explicitly. The loaded objects are available at
     * the .objects property, although you probably want to
     * use kubeSelect() to interact with these objects.
     *
     * loader.handle(objects, [removed])
     *
     * Tell the loader about a objects that has been loaded
     * or removed elsewhere.
     *
     * loader.listen(callback)
     *
     * Register a callback to be invoked some time after new
     * objects have been loaded. Returns an object with a
     * .cancel() method, that can be used to stop listening.
     *
     * promise = loader.load(path)
     * promise = loader.load(involvedObject)
     * promise = loader.load(resource)
     * promise = loader.load(kind, [name], [namespace])
     *
     * Load the resource at the path. Returns a promise that will
     * resolve with the resource or an array of objects at the
     * given path.
     *
     * ns = loader.namespace()
     *
     * Return the current namespace that watches are limited to
     * or null if watching all namespaces.
     *
     * loader.namespace("value")
     *
     * Change the namespace that watches are limited to. Specify a
     * value of null to watch all namespaces. This will clear out
     * all loaded objects, and start all watches again.
     *
     * loader.reset([total])
     *
     * Clear out all loaded objects, and clear all watches. If
     * the total flag is set, won't restart the watches, but
     * clear all the loaded state.
     *
     * loader.objects
     *
     * A dict of all loaded objects.
     *
     * promise = loader.watch(type)
     * promise = loader.watch(path)
     *
     * Start watching the given resource type. The returned promise
     * will be resolved when an initial set of objects have been
     * loaded for the watch, or rejected if the watch has failed.
     */

    .factory("kubeLoader", [
        "$q",
        "$exceptionHandler",
        "$timeout",
        "KubeWatch",
        "KubeRequest",
        "KUBE_SCHEMA",
        function($q, $exceptionHandler, $timeout, KubeWatch, KubeRequest, KUBE_SCHEMA) {
            var callbacks = [];
            var onlyNamespace = null;

            /* All the current watches */
            var watches = { };

            /* All the loaded objects */
            var objects = { };

            /* Timeout batching */
            var batch = null;
            var batchTimeout = null;

            function ensureWatch(what, namespace) {
                var path = resourcePath([what, null, namespace || onlyNamespace]);
                if (!(path in watches)) {
                    watches[path] = new KubeWatch(path, handleFrames);
                    watches[path].arguments = [what, namespace];
                }
                return watches[path];
            }

            function handleFrames(frames) {
                if (batch === null)
                    batch = frames;
                else
                    batch.push.apply(batch, frames);

                /* When called with empty data, flush, don't wait */
                if (frames.length > 0) {
                    if (batchTimeout === null)
                        batchTimeout = window.setTimeout(handleTimeout, 150);
                    else
                        return; /* called again later */
                }

                handleFlush();
            }

            function handleFlush() {
                var drain = batch;
                batch = null;

                if (!drain)
                    return;

                var present = { };
                var removed = { };
                var i, len, frame, link, resource;

                for (i = 0, len = drain.length; i < len; i++) {
                    resource = drain[i].object;
                    if (resource) {
                        link = resourcePath([resource]);
                        if (drain[i].type == "DELETED") {
                            delete objects[link];
                            removed[link] = resource;
                        } else {
                            present[link] = resource;
                            objects[link] = resource;
                        }
                    }
                }

                /* Run all the listeners and then digest */
                invokeCallbacks(present, removed);
            }

            function invokeCallbacks(/* ... */) {
                var i, len, func;
                for (i = 0, len = callbacks.length; i < len; i++) {
                    func = callbacks[i];
                    try {
                        if (func)
                            func.apply(self, arguments);
                    } catch (e) {
                        $exceptionHandler(e);
                    }
                }
            }

            function handleTimeout() {
                batchTimeout = null;
                handleFlush();
            }

            function resetLoader(total) {
                var link, path;

                /* We drop any batched objects in flight */
                window.clearTimeout(batchTimeout);
                batchTimeout = null;
                batch = null;

                /* Cancel all the watches  */
                angular.forEach(watches, function(watch) {
                    watch.cancel();
                });

                /* Clear out everything */
                for (link in objects)
                    delete objects[link];

                var old = watches;
                watches = { };

                if (total)
                    onlyNamespace = null;

                /* Tell the callbacks we're resetting */
                invokeCallbacks();

                /* Recreate all the watches as necessary */
                if (!total) {
                    angular.forEach(old, function(watch) {
                        ensureWatch.apply(this, watch.arguments);
                    });
                }
            }

            function handleObjects(objects, removed, kind) {
                handleFrames(objects.map(function(resource) {
                    if (kind)
                        resource.kind = kind;
                    return {
                        type: removed ? "DELETED" : "ADDED",
                        object: resource
                    };
                }));
                handleFlush();
            }

            function loadObjects(/* ... */) {
                var path = resourcePath(arguments);
                var req = new KubeRequest("GET", path);
                var promise = req.then(function(response) {
                    req = null;
                    var resource = response.data;
                    if (!resource || !resource.kind) {
                        return null;
                    } else if (resource.kind.indexOf("List") === resource.kind.length - 4) {
                        handleObjects(resource.items, false, resource.kind.slice(0, -4));
                        return resource.items;
                    } else {
                        handleObjects([resource]);
                        return resource;
                    }
                }, function(response) {
                    req = null;
                    throw response;
                });
                promise.cancel = function cancel(ex) {
                    req.cancel(ex);
                };
                return promise;
            }

            var self = {
                watch: ensureWatch,
                load: function load(/* ... */) {
                    return loadObjects.apply(this, arguments);
                },
                namespace: function namespace(value) {
                    if (value !== undefined) {
                        onlyNamespace = value;
                        resetLoader();
                    }
                    return onlyNamespace;
                },
                reset: function reset(total) {
                    resetLoader(total);
                },
                listen: function listen(callback, before) {
                    if (before)
                        callbacks.unshift(callback);
                    else
                        callbacks.push(callback);
                    var timeout = $timeout(function() {
                        timeout = null;
                        callback.call(self, objects);
                    }, 0);
                    return {
                        cancel: function() {
                            var i, len;
                            $timeout.cancel(timeout);
                            timeout = null;
                            for (i = 0, len = callbacks.length; i < len; i++) {
                                if (callbacks[i] === callback)
                                    callbacks[i] = null;
                            }
                        }
                    };
                },
                handle: function handle(objects, removed) {
                    if (!angular.isArray(objects))
                        objects = [ objects ];
                    handleObjects(objects, removed);
                },
                resolve: function resolve(/* ... */) {
                    return resourcePath(arguments);
                },
                objects: objects,
            };

            return self;
        }
    ])

    /**
     * kubeSelect
     *
     * Allows selecting loaded objects based on various criteria. The
     * goal here is to allow selection to be fast enough that it can be
     * done repeatedly and regularly, without keeping caches of objects
     * all over the place.
     *
     * Resources may be filtered in a chain by calling various filter
     * functions. Lets start with an example that finds a pod:
     *
     *   pod = kubeSelect()
     *      .kind("Pod")
     *      .namespace("default")
     *      .name("docker-registry")
     *      .one();
     *
     * Calling kubeSelect() will return a dict with all loaded objects,
     * containing unique keys, and then various filters can be called to
     * further narrow results.
     *
     * You can also pass a dict of objects into kubeSelect() and then
     * perform actions on it.
     *
     * The following filters are available by default:
     *
     *  .kind(kind)       Limit to specified kind
     *  .namespace(ns)    Limit to specified namespace
     *  .name(name)       Limit to this name
     *  .label(selector)  Limit to objects whose label match selector
     *  .one()            Choose one of results, or null
     *  .extend(obj)      Extend obj with the results
     *
     * Additional filters can be registered by calling the function:
     *
     *   kubeSelect.register(name, function)
     *   kubeSelect.register(filterobj)
     *
     * Ask on FreeNode #cockpit for documentation on filters.
     */

    .factory("kubeSelect", [
        "kubeLoader",
        function(loader) {
            /* A list of all registered filters */
            var filters = { };

            /* A hash index */
            var index = null;

            /* The filter prototype for functions available on selector */
            var proto = null;

            /* Cache data */
            var weakmap = new SimpleWeakMap();
            var version = 1;

            loader.listen(function(present, removed) {
                version += 1;

                /* Get called like this when reset */
                if (!present) {
                    index = null;

                /* Called like this when more objects arrive */
                } else if (index) {
                    indexObjects(present);
                }
            }, true);

            /* Create a new index and populate */
            function indexCreate() {
                var name, filter;

                /* TODO: Derive this value from cluster size */
                index = new HashIndex(262139);

                /* And index all the objects */
                indexObjects(loader.objects);
            }

            /* Populate index for the given objects and current filters */
            function indexObjects(objects) {
                var link, object, name, key, keys, filter;
                for (link in objects) {
                    object = objects[link];
                    for (name in filters) {
                        filter = filters[name];
                        if (filter.digest) {
                            key = filter.digest.call(null, object);
                            if (key)
                                index.add([ key ], link);
                        } else if (filter.digests) {
                            keys = filter.digests.call(null, object);
                            if (keys.length)
                                index.add(keys, link);
                        }
                    }
                }
            }

            /* Return a place to cache data related to obj */
            function cached(obj) {
                var data = weakmap.get(obj);
                if (!data || data.version !== version) {
                    data = { version: version, length: data ? data.length : undefined };
                    weakmap.set(obj, data);
                }
                return data;
            }

            function makePrototypeCall(filter) {
                return function() {
                    var cache = cached(this);

                    /*
                     * Do this early, since some browsers cannot pass
                     * arguments to JSON.stringify()
                     */
                    var args = Array.prototype.slice.call(arguments);

                    /* Fast path, already calculated results */
                    var desc = filter.name + ": " + JSON.stringify(args);
                    if (desc in cache)
                        return cache[desc];

                    var results;
                    if (filter.filter) {
                        results = filter.filter.apply(this, args);

                    } else {
                        if (!index)
                            indexCreate();
                        if (!cache.indexed) {
                            indexObjects(this);
                            cache.indexed = true;
                        }
                        if (filter.digests) {
                            results = digestsFilter(filter, this, args);
                        } else if (filter.digest) {
                            results = digestFilter(filter, this, args);
                        } else {
                            console.warn("invalid filter: " + filter.name);
                            results = { };
                        }
                    }

                    cache[desc] = results;
                    return results;
                };
            }

            function makePrototype() {
                var name, ret = {
                    length: {
                        enumerable: false,
                        configurable: true,
                        get: function() { return cached(this).length; }
                    }
                };
                for (name in filters) {
                    ret[name] = {
                        enumerable: false,
                        configurable: true,
                        value: makePrototypeCall(filters[name])
                    };
                }
                return ret;
            }

            function mixinSelection(results, length, indexed) {
                var link, data;
                if (length === undefined) {
                    length = 0;
                    for (link in results)
                        length += 1;
                }
                proto = proto || makePrototype();
                Object.defineProperties(results, proto);
                data = cached(results);
                data.length = length;
                data.selection = results;
                data.indexed = indexed;
                return results;
            }

            function digestFilter(filter, what, criteria) {
                var p, pl, key, keyo, possible, link, object;
                var results = { }, count = 0;

                key = filter.digest.apply(null, criteria);
                if (key !== null && key !== undefined) {
                    possible = index.get(key);
                } else {
                    possible = [];
                }

                for (p = 0, pl = possible.length; p < pl; p++) {
                    link = possible[p];
                    object = what[link];
                    if (object) {
                        if (key === filter.digest.call(null, object)) {
                            results[link] = object;
                            count += 1;
                        }
                    }
                }

                return mixinSelection(results, count, true);
            }

            function digestsFilter(filter, what, criteria) {
                var keys, keyn, keyo, k, link, match, object, possible;
                var p, pl, j, jl;
                var results = { }, count = 0;

                keys = filter.digests.apply(null, criteria);
                keyn = keys.length;
                if (keyn > 0) {
                    possible = index.all(keys);
                    keys.sort();
                } else {
                    possible = [];
                }

                for (p = 0, pl = possible.length; p < pl; p++) {
                    link = possible[p];
                    object = what[link];
                    if (object) {
                        keyo = filter.digests.call(null, object);
                        keyo.sort();
                        match = false;

                        /* Search for first key */
                        for (j = 0, jl = keyo.length; !match && j < jl; j++) {
                            if (keys[0] === keyo[j]) {
                                match = true;
                                for (k = 0; match && k < keyn; k++) {
                                    if (keys[k] !== keyo[j + k])
                                        match = false;
                                }
                            }
                        }

                        if (match) {
                            results[link] = object;
                            count += 1;
                        }
                    }
                }

                return mixinSelection(results, count, true);
            }

            function registerFilter(filter, optional) {
                if (typeof (optional) == "function") {
                    filter = {
                        name: filter,
                        filter: optional,
                    };
                }

                filters[filter.name] = filter;
                index = null;
                proto = null;
                version += 1;
            }

            /* The one filter */
            registerFilter("one", function() {
                var link;
                for (link in this)
                    return this[link];
                return null;
            });

            /* The extend filter */
            registerFilter("extend", function(target) {
                var link;
                for (link in this)
                    target[link] = this[link];
                return target;
            });

            /* The label filter */
            registerFilter({
                name: "label",
                digests: function(arg) {
                    var i, ret = [], meta = arg.metadata;
                    var labels = meta ? meta.labels : arg;
                    for (i in labels || [])
                        ret.push(i + "=" + labels[i]);
                    return ret;
                }
            });

            /* The namespace filter */
            registerFilter({
                name: "namespace",
                digest: function(arg) {
                    if (typeof arg === "string")
                        return arg;
                    var meta = arg.metadata;
                    return meta ? meta.namespace : null;
                }
            });

            /* The name filter */
            registerFilter({
                name: "name",
                digest: function(arg) {
                    if (typeof arg === "string")
                        return arg;
                    var meta = arg.metadata;
                    return meta ? meta.name : null;
                }
            });

            /* The kind filter */
            registerFilter({
                name: "kind",
                digest: function(arg) {
                    if (typeof arg === "string")
                        return arg;
                    return arg.kind;
                }
            });

            function selection(what, indexed) {
                return cached(what).selection || mixinSelection(what, undefined, indexed);
            }

            function select(arg) {
                var what, meta, i, len;
                if (!arg) {
                    return selection(loader.objects, true);

                } else if (typeof arg == "object") {
                    if (typeof arg.kind == "string") {
                        if (arg.items) {
                            arg = arg.items;
                        } else {
                            arg = [ arg ];
                        }
                    }

                    if (typeof arg.length == "number") {
                        what = { };
                        for (i = 0, len = arg.length; i < len; i++) {
                            meta = arg[i].metadata || { };
                            what[meta.selfLink || i] = arg[i];
                        }
                        return selection(what);

                    } else {
                        return selection(arg);
                    }
                }

                console.warn("Pass resources or resource dicts or null to kubeSelect()");
                return selection({ });
            }

            /* A seldom used 'static' method */
            select.register = registerFilter;

            return select;
        }
    ])

    /**
     * kubeMethods
     *
     * Methods that operate on kubernetes objects.
     *
     * promise = methods.create(objects, namespace)
     *
     * Create the given resource or objects in the specified namespace.
     *
     * promise = methods.remove(resource)
     * promise = methods.remove(path)
     * promise = methods.remove(type, name, namespace)
     *
     * Delete the given resource from kubernetes.
     */
    .factory("kubeMethods", [
        "$q",
        "KUBE_SCHEMA",
        "KubeRequest",
        "kubeLoader",
        function($q, KUBE_SCHEMA, KubeRequest, loader) {
            function createCompare(a, b) {
                var sa = KUBE_SCHEMA[a.kind].create || 0;
                var sb = KUBE_SCHEMA[b.kind].create || 0;
                return sa - sb;
            }

            function createObjects(objects, namespace) {
                var defer = $q.defer();
                var promise = defer.promise;
                var request = null;

                if (!angular.isArray(objects)) {
                    if (objects.kind == "List")
                        objects = objects.items;
                    else
                        objects = [ objects ];
                }

                var haveNs = false;
                var wantNs = false;

                objects.forEach(function(resource) {
                    var meta = resource.metadata;
                    if (resource.kind == "Namespace" && meta && meta.name === namespace)
                        haveNs = true;
                    var schema = SCHEMA[resource.kind] || SCHEMA[""];
                    if (!schema.global)
                        wantNs = true;
                });

                /* Shallow copy of the array, we modify it below */
                objects = objects.slice();

                /* Create the namespace  */
                if (namespace && wantNs && !haveNs) {
                    objects.unshift({
                        apiVersion : "v1",
                        kind : "Namespace",
                        metadata : { name: namespace }
                    });
                }

                /* Now sort the array with create preference */
                objects.sort(createCompare);

                function step() {
                    var resource = objects.shift();
                    if (!resource) {
                        defer.resolve();
                        return;
                    }

                    var path = resourcePath([resource.kind, null, namespace || "default"]);
                    request = new KubeRequest("POST", path, JSON.stringify(resource))
                        .then(function(response) {
                            debug("created resource:", path, response.data);
                            if (response.data.kind)
                                loader.handle(response.data);
                            step();
                        }, function(response) {
                            var resp = response.data;

                            /* Ignore failures creating the namespace if it already exists */
                            if (resource.kind == "Namespace" && resp && resp.code === 409) {
                                debug("skipping namespace creation");
                                step();
                            } else {
                                debug("create failed:", path, resp || response);
                                defer.reject(resp || response);
                            }
                        });
                }

                step();

                promise.cancel = function cancel() {
                    if (request)
                        request.cancel();
                };
                return promise;
            }

            function deleteResource(/* ... */) {
                var path = resourcePath(arguments);
                var resource = loader.objects[path];
                var promise = new KubeRequest("DELETE", path);
                return promise.then(function() {
                    if (resource)
                        loader.handle(resource, true);
                }, function(response) {
                    var resp = response.data;
                    throw resp || response;
                });
            }

            return {
                "create": createObjects,
                "delete": deleteResource
            };
        }
    ])

    /**
     * KubeRequest
     *
     * Create a new low level kubernetes request. These are instantiated
     * by kubeLoader or kubeMethods, and typically not used directly.
     *
     * An implementation of KubeRequest must be provided. It has the
     * following characteristics.
     *
     * promise = KubeRequest(method, path, [body, [config]])
     *
     * Creates a new request, for the given HTTP method and path. If body
     * is present it will be sent as the request body. If it an object or
     * array it will be encoded as JSON before being sent.
     *
     * If present the config object may include the following properties:
     *
     *  headers    An dict of headers to include
     *
     * In addition the config object can include implementation specific
     * settings or data.
     *
     * If successful the promise will resolve with a response object that
     * includes the following:
     *
     * status      Status code
     * statusText  Status reason or message
     * data        Response body, JSON decoded if response is json
     * headers     Response headers
     *
     * Implementation specific fields may also be present
     */

    .provider("KubeRequest", [
        function() {
            var self = this;

            /* Until we come up with a good default implementation, must be provided */
            self.KubeRequestFactory = "MissingKubeRequest";

            function load(injector, name) {
                if (angular.isString(name))
                    return injector.get(name, "KubeRequest");
                else
                    return injector.invoke(name);
            }

            self.$get = [
                "$injector",
                function($injector) {
                    return load($injector, self.KubeRequestFactory);
                }
            ];
        }
    ])

    .factory("MissingKubeRequest", [
        function() {
            return function MissingKubeRequest(path, callback) {
                throw "no KubeRequestFactory set";
            };
        }
    ])

    /**
     * KubeWatch
     *
     * Create a new low level kubernetes watch. These are instantiated
     * by kubeLoader, and typically not used directly.
     *
     * An implementation of the KubeWatch must be provided. It has the
     * following characteristics:
     *
     * promise = KubeWatch(path, callback)
     *
     * The watch is given two arguments. The first is the kube resource
     * url to watch (without query string) a callback to invoke with
     * watch frames.
     *
     * The watch returns a deferred promise which will resolve when the initial
     * set of items has loaded, it will fail if the watch fails. The promise
     * should also have a promise.cancel() method which is invoked when the
     * watch should be stopped.
     *
     * callback(frames)
     *
     * The callback is invoked with an array of kubernetes watch frames that
     * look like: { type: "ADDED", object: { ... } }
     */

    .provider("KubeWatch", [
        function() {
            var self = this;

            /* Until we come up with a good default implementation, must be provided */
            self.KubeWatchFactory = "MissingKubeWatch";

            function load(injector, name) {
                if (angular.isString(name))
                    return injector.get(name, "KubeWatch");
                else
                    return injector.invoke(name);
            }

            self.$get = [
                "$injector",
                function($injector) {
                    return load($injector, self.KubeWatchFactory);
                }
            ];
        }
    ])

    .factory("MissingKubeWatch", [
        function() {
            return function MissingKubeWatch(path, callback) {
                throw "no KubeWatchFactory set";
            };
        }
    ]);


}());
