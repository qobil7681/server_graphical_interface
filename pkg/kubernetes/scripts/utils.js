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

    angular.module("kubeUtils", [])

    .factory("KubeMapNamedArray", [
        function () {
            return function mapNamedArray(array) {
                var result = { };
                var i, len;
                if (array) {
                    for (i = 0, len = array.length; i < len; i++)
                        result[array[i].name] = array[i];
                }
                return result;
            };
        }
    ])

    .factory("KubeStringToBytes", [
        function() {
            return function (byte_string) {
                var valid_suffixes = {
                    "E": 1000000000000000000,
                    "P": 1000000000000000,
                    "T": 1000000000000,
                    "G": 1000000000,
                    "M": 1000000,
                    "K": 1000,
                    "m": 0.001,
                    "Ei": 1152921504606846976,
                    "Pi": 1125899906842624,
                    "Ti": 1099511627776,
                    "Gi": 1073741824,
                    "Mi": 1048576,
                    "Ki": 1024,
                };

                if (!byte_string)
                    return;

                byte_string = byte_string.trim();
                for (var key in valid_suffixes) {
                    if (byte_string.length > key.length &&
                        byte_string.slice(-key.length) === key) {
                        var number = Number(byte_string.slice(0, -key.length));
                        if (!isNaN(number))
                            return number * valid_suffixes[key];
                    }
                }
            };
        }
    ])

    .provider('KubeFormat', [
        function() {
            var self = this;

            /* Until we come up with a good default implementation, must be provided */
            self.KubeFormatFactory = "MissingFormat";

            function load(injector, name) {
                if (angular.isString(name))
                    return injector.get(name, "KubeFormat");
                else
                    return injector.invoke(name);
            }

            self.$get = [
                "$injector",
                function($injector) {
                    return load($injector, self.KubeFormatFactory);
                }
            ];
        }
    ])

    .factory("MissingFormat", [
        function() {
            return function MissingFormatCapacity(value) {
                throw "no KubeFormatFactory set";
            };
        }
    ])

    .provider('KubeTranslate', [
        function() {
            var self = this;

            /* Until we come up with a good default implementation, must be provided */
            self.KubeTranslateFactory = "KubeTranslate";

            function load(injector, name) {
                if (angular.isString(name))
                    return injector.get(name, "MissingKubeTranslate");
                else
                    return injector.invoke(name);
            }

            self.$get = [
                "$injector",
                function($injector) {
                    return load($injector, self.KubeTranslateFactory);
                }
            ];
        }
    ])

    .factory("MissingKubeTranslate", [
        function() {
            function error_func() {
                throw "no KubeTranslateFactory set";
            }

            return {
                gettext: error_func,
                ngettext: error_func
            };
        }
    ]);

}());
