/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

var utils = require("./utils");
var QUnit = require("qunit-tests");
var assert = QUnit;

QUnit.test("format_delay", function() {
    var checks = [
        [ 15550000, "4 hours, 19 minutes, 10 seconds" ]
    ];

    assert.expect(checks.length);
    for (var i = 0; i < checks.length; i++) {
        assert.strictEqual(utils.format_delay(checks[i][0]), checks[i][1],
                           "format_delay(" + checks[i][0] + ") = " + checks[i][1]);
    }
});

QUnit.test("compare_versions", function() {
    var checks = [
        [ "",      "",      0 ],
        [ "0",     "0",     0 ],
        [ "1",     "0",     1 ],
        [ "0",     "1",    -1 ],
        [ "2",     "1.9",   1 ],
        [ "2.0",   "2",     1 ],
        [ "2.1.6", "2.5",  -1 ],
        [ "2..6",  "2.0.6", 0 ],
    ];

    /* Polyfill during testing */
    Math.sign = Math.sign || function(x) {
        x = +x; /* convert to a number */
        if (x === 0 || isNaN(x))
            return Number(x);
        return x > 0 ? 1 : -1;
    };

    function check(a, b, expected) {
        assert.strictEqual(Math.sign(utils.compare_versions(a, b)), expected,
                           "compare_versions(" + a + ", " + b + ") = ", expected);
    }

    assert.expect(checks.length);
    for (var i = 0; i < checks.length; i++) {
        check(checks[i][0], checks[i][1], checks[i][2]);
    }
});

QUnit.start();
