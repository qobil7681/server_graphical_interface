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

    angular.module('kubernetes.dashboard', [
        'ngRoute',
        'ui.cockpit',
        'kubernetes.details',
        'kubernetes.app',
        'kubernetes.graph'
    ])

    .config(['$routeProvider', function($routeProvider) {
        $routeProvider.when('/', {
            templateUrl: 'views/dashboard-page.html',
            controller: 'DashboardCtrl',
            reloadOnSearch: false,
        });
    }])

    .controller('DashboardCtrl', [
        '$scope',
        'kubeLoader',
        'kubeSelect',
        'dashboardActions',
        'itemActions',
        '$location',
        function($scope, loader, select, actions, itemActions, $location) {

        var c = loader.listen(function() {
            $scope.services = select().kind("Service");
            $scope.nodes = select().kind("Node");
            $scope.pods = select().kind("Pod");
        });

        $scope.$on("$destroy", function() {
            c.cancel();
        });

        loader.watch("Node");
        loader.watch("Service");
        loader.watch("ReplicationController");
        loader.watch("Pod");

        $scope.editServices = false;
        $scope.toggleServiceChange = function toggleServiceChange() {
            $scope.editServices = !$scope.editServices;
        };

        $scope.serviceContainers = function serviceContainers(service) {
            var spec = service.spec || { };
            var meta = service.metadata || {};

            /* Calculate number of containers */
            var x = 0;
            var y = 0;

            /*
             * Calculate "x of y" containers, where x is the current
             * number and y is the expected number. If x==y then only
             * show x. The calculation is based on the statuses of the
             * containers within the pod.  Pod states: Pending,
             * Running, Succeeded, Failed, and Unknown.
             */
            var pods = select().kind("Pod").namespace(meta.namespace || "")
                        .label(spec.selector || {});
            angular.forEach(pods, function(pod) {
                if (!pod.status || !pod.status.phase)
                    return;
                var spec = pod.spec || { };
                var n = 1;
                if (spec.containers)
                    n = spec.containers.length;
                switch (pod.status.phase) {
                case "Pending":
                    y += n;
                    break;
                case "Running":
                    x += n;
                    y += n;
                    break;
                case "Succeeded": // don't increment either counter
                    break;
                case "Unknown":
                    y += n;
                    break;
                case "Failed":
                    /* falls through */
                default: /* assume failed */
                    y += n;
                    break;
                }
            });

            if (x != y)
                return x + " of " + y;
            else
                return "" + x;
        };

        $scope.serviceStatus = function serviceStatus(service) {
            var spec = service.spec || { };
            var meta = service.metadata || { };
            var state = "";

            var pods = select().kind("Pod").namespace(meta.namespace || "")
                        .label(spec.selector || {});
            angular.forEach(pods, function(pod) {
                if (!pod.status || !pod.status.phase)
                    return;
                switch (pod.status.phase) {
                case "Pending":
                    if (!state)
                        state = "wait";
                    break;
                case "Running":
                    break;
                case "Succeeded":
                    break;
                case "Unknown":
                    break;
                case "Failed":
                    /* falls through */
                default: /* assume failed */
                    state = "fail";
                    break;
                }
            });

            return state;
        };

        /* Node listing */
        $scope.nodeContainers = function nodeContainers(node) {
            var count = 0;
            var meta = node.metadata || { };
            angular.forEach(select().kind("Pod").host(meta.name), function(pod) {
                var spec = pod.spec || { };
                var n = 1;
                if (spec.containers)
                    n = spec.containers.length;
                count += n;
            });
            return count;
        };

        $scope.nodeStatus = function nodeStatus(node) {
            var status = node.status || { };
            var conditions = status.conditions;
            var state = "";

            /* If no status.conditions then it hasn't even started */
            if (!conditions) {
                state = "wait";
            } else {
                conditions.forEach(function(condition) {
                    if (condition.type == "Ready") {
                        if (condition.status != "True")
                            state = "fail";
                    }
                });
            }
            return state;
        };

        $scope.jumpService = function jumpService(ev, service) {
            if ($scope.editServices)
                return;

            var meta = service.metadata || {};
            var spec = service.spec || {};
            if (spec.selector && !angular.equals({}, spec.selector) && meta.namespace)
                $location.path("/pods/" + encodeURIComponent(meta.namespace)).search(spec.selector);
        };

        /* All the actions available on the $scope */
        angular.extend($scope, actions);
        $scope.modifyService = itemActions.modifyService;

        /* Highlighting */

        $scope.highlighted = null;
        $scope.$on("highlight", function(ev, uid) {
            $scope.highlighted = uid;
        });
        $scope.highlight = function highlight(uid) {
            $scope.$broadcast("highlight", uid);
        };

        $scope.servicesState = function services_state() {
            if ($scope.failure)
                return 'failed';
            var service;
            for (service in $scope.services)
                break;
            return service ? 'ready' : 'empty';
        };
    }])

    .directive('kubernetesStatusIcon', function() {
        return {
            restrict: 'A',
            link: function($scope, element, attributes) {
                $scope.$watch(attributes["status"], function(status) {
                    element
                        .toggleClass("spinner spinner-sm", status == "wait")
                        .toggleClass("fa fa-exclamation-triangle fa-failed", status == "fail");
                });
            }
        };
    })

    .directive('kubernetesAddress', function() {
        return {
            restrict: 'E',
            link: function($scope, element, attributes) {
                $scope.$watchGroup(["item.spec.clusterIP", "item.spec.ports"], function(values) {
                    var address = values[0];
                    var ports = values[1];
                    var href = null;
                    var text = null;

                    /* No ports */
                    if (!ports || !ports.length) {
                        text = address;

                    /* One single HTTP or HTTPS port */
                    } else if (ports.length == 1) {
                        text = address + ":" + ports[0].port;
                        if (ports[0].protocol === "TCP") {
                            if (ports[0].port === 80)
                                href = "http://" + encodeURIComponent(address);
                            else if (ports[0].port === 443)
                                href = "https://" + encodeURIComponent(address);
                        } else {
                            text += "/" + ports[0].protocol;
                        }
                    } else {
                        text = " " + address + " " + ports.map(function(p) {
                            if (p.protocol === "TCP")
                                return p.port;
                            else
                                return p.port + "/" + p.protocol;
                        }).join(" ");
                    }

                    var el;
                    element.empty();
                    if (href) {
                        el = angular.element("<a>")
                            .attr("href", href)
                            .attr("target", "_blank")
                            .on("click", function(ev) { ev.stopPropagation(); });
                        element.append(el);
                    } else {
                        el = element;
                    }
                    el.text(text);
                });
            }
        };
    })

    .factory('dashboardActions', [
        '$modal',
        function($modal) {
            function deploy() {
                return $modal.open({
                    animation: false,
                    controller: 'DeployCtrl',
                    templateUrl: 'views/deploy.html',
                    resolve: {},
                }).result;
            }

            function addNode() {
                return $modal.open({
                    animation: false,
                    controller: 'AddNodeCtrl',
                    templateUrl: 'views/node-add.html',
                    resolve: {},
                }).result;
            }

            return {
                addNode: addNode,
                deploy: deploy,
            };
        }
    ])

    .controller("AddNodeCtrl", [
        "$q",
        "$scope",
        "$modalInstance",
        "kubeMethods",
        "KubeTranslate",
        function($q, $scope, $instance, methods, translate) {
            var _ = translate.gettext;
            var fields = {
                "address" : "",
                "name" : "",
            };
            var dirty = false;

            $scope.fields = fields;

            function validate() {
                var regex = /^[a-z0-9.-]+$/i;
                var defer = $q.defer();
                var address = fields.address.trim();
                var name = fields.name.trim();
                var ex;
                var failures = [];
                var item;

                if (!address)
                    ex = new Error(_("Please type an address"));
                else if (!regex.test(address))
                    ex = new Error(_("The address contains invalid characters"));

                if (ex) {
                    ex.target = "#node-address";
                    failures.push(ex);
                }

                if (name && !regex.test(name)) {
                    ex = new Error(_("The name contains invalid characters"));
                    ex.target = "#node-name";
                    failures.push(ex);
                }

                if (failures.length > 0) {
                    defer.reject(failures);
                } else {
                    item = {
                        "kind": "Node",
                        "apiVersion": "v1",
                        "metadata": {
                            "name": name ? name : address,
                        },
                        "spec": {
                            "externalID": address
                        }
                    };
                    defer.resolve(item);
                }

                return defer.promise;
            }

            $scope.nameKeyUp = function nameKeyUp(event) {
                dirty = true;
                if (event.keyCode == 13)
                    $scope.performAdd();
            };

            $scope.addressKeyUp = function addressKeyUp(event) {
                if (event.keyCode == 13)
                    $scope.performAdd();
                else if (!dirty)
                    fields.name = event.target.value;
            };

            $scope.performAdd = function performAdd() {
                return validate().then(function(item) {
                    return methods.create(item);
                });
            };
        }
    ])

    .controller("DeployCtrl", [
        "$q",
        "$scope",
        "$timeout",
        "$modalInstance",
        "filterService",
        "kubeMethods",
        "KubeFormat",
        "KubeTranslate",
        function($q, $scope, $timeout, $instance, filter, methods, KubeFormat, translate) {
            var _ = translate.gettext;

            var file;
            var fields = {
                "filename": "",
                "namespace" : filter.namespace(),
            };

            function validate_manifest() {
                var defer = $q.defer();
                var ex, data, fails = [];

                var ns = fields.namespace;
                if (!ns)
                    ex = new Error(_("Namespace cannot be empty."));
                else if (!/^[a-z0-9]+$/i.test(ns))
                    ex = new Error(_("Please provide a valid namespace."));
                if (ex) {
                    ex.target = "#deploy-app-namespace-group";
                    fails.push(ex);
                    ex = null;
                }

                if (!file)
                    ex = new Error(_("No metadata file was selected. Please select a Kubernetes metadata file."));
                else if (file.type && !file.type.match("json.*"))
                    ex = new Error(_("The selected file is not a valid Kubernetes application manifest."));
                if (ex) {
                    ex.target = "#deploy-app-manifest-file-button";
                    fails.push(ex);
                    ex = null;
                }

                var reader;

                if (fails.length) {
                    defer.reject(fails);

                } else {
                    reader = new window.FileReader();
                    reader.onerror = function(event) {
                        ex = new Error(KubeFormat.format(_("Unable to read the Kubernetes application manifest. Code $0."),
                                       event.target.error.code));
                        ex.target = "#deploy-app-manifest-file-button";
                        defer.reject(ex);
                    };
                    reader.onload = function() {
                        try {
                            defer.resolve({
                                objects : JSON.parse(reader.result),
                                namespace : ns
                            });
                        } catch (err) {
                            ex = new Error(KubeFormat.format(_("Unable to decode Kubernetes application manifest.")));
                            ex.target = "#deploy-app-manifest-file-button";
                            defer.reject(ex);
                        }
                    };
                    reader.readAsText(file);
                }

                return defer.promise;
            }

            function deploy_manifest() {
                var defer = $q.defer();

                validate_manifest().then(function(data) {
                    methods.create(data.objects, data.namespace)
                    .then(function() {
                        if ($scope.namespace && data.namespace != $scope.namespace)
                            filter.namespace(data.namespace);
                        defer.resolve();
                    })
                    .catch(function(response) {
                        var msg;
                        var ex;
                        var resp = response.data;

                        /* Interpret this code as a conflict, so suggest user creates a new namespace */
                        if (response && response.code === 409) {
                            ex = new Error(KubeFormat.format(_("Please create another namespace for $0 \"$1\""),
                                                             response.details.kind, response.details.id));
                            ex.target = "#deploy-app-namespace-field";
                        } else {
                            ex = resp ? resp : response;
                        }

                        defer.reject(ex);
                    });
                }, function(ex) {
                    defer.reject(ex);
                });

                return defer.promise;
            }


            $scope.types = [
                {
                    name: _("Kubernetes Manifest"),
                    type: "manifest",
                }
            ];

            $scope.selected = $scope.types[0];
            $scope.fields = fields;
            $scope.namespaces = filter.namespaces();
            $scope.namespace = filter.namespace();

            $scope.fileBtnClick = function(event) {
                var parent = angular.element(event.target).parent()[0];
                var file_input;
                if (parent)
                    file_input = parent.querySelector('#deploy-app-manifest-file');

                if (file_input) {
                    $timeout(function () {
                        file_input.click();
                    });
                }
            };

            $scope.fileSelected = function(element) {
                $scope.$applyAsync(function() {
                    var files = element.files || [];
                    file = files[0];
                    fields.filename = file ? file.name : "";
                });
            };

            $scope.performDeploy = function performDeploy() {
                if ($scope.selected.type == 'manifest') {
                    return deploy_manifest();
                }
            };

            $scope.select = function(type) {
                $scope.selected = type;
            };
        }
    ]);
}());
