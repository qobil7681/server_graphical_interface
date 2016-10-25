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

QUnit.test("auto_fstab_spec", function() {
    var checks = [
        {
            name: "with-uuid",
            block: { IdUUID: "thisismyuuid", Device: "L2Rldi9zZGExAA==" },
            result: "UUID=thisismyuuid",
        },
        {
            name: "without-uuid",
            block: { Device: "L2Rldi9zZGExAA==" },
            result: "/dev/sda1",
        }
    ];

    assert.expect(checks.length);
    checks.forEach(function(check) {
        assert.strictEqual(utils.auto_fstab_spec(check.block), check.result, check.name);
    });
});

QUnit.test("auto_luks_name", function() {
    var checks = [
        {
            name: "with-uuid",
            block: { IdUUID: "thisismyuuid", Device: "L2Rldi9zZGExAA==" },
            result: "luks-thisismyuuid",
        },
        {
            name: "without-uuid",
            block: { Device: "L2Rldi9zZGExAA==" },
            result: "luks-sda1",
        }
    ];

    assert.expect(checks.length);
    checks.forEach(function(check) {
        assert.strictEqual(utils.auto_luks_name(check.block), check.result, check.name);
    });
});

QUnit.start();
