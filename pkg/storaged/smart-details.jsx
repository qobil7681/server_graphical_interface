/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import cockpit from "cockpit";
import React, { useState } from "react";
import * as timeformat from "timeformat.js";

import { Card, CardBody, CardHeader, CardTitle, DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core";
import { Dropdown, DropdownItem, KebabToggle } from '@patternfly/react-core/dist/esm/deprecated/components/Dropdown/index.js';

const _ = cockpit.gettext;

const selftestStatusDescription = {
    success: _("Successful"),
    aborted: _("Aborted"),
    interrupted: _("Interrupted"),
    fatal: _("Did not complete"),
    error_unknown: _("Failed (Unknown)"),
    error_electrical: _("Failed (Electrical)"),
    error_servo: _("Failed (Servo)"),
    error_read: _("Failed (Read)"),
    error_handling: _("Failed (Damaged)"),
    inprogress: _("In progress"),
};

const SmartActions = ({ smartInfo }) => {
    const [isKebabOpen, setKebabOpen] = useState(false);
    const smartSelftestStatus = smartInfo.SmartSelftestStatus;

    const runSmartTest = async (type) => {
        await smartInfo.SmartSelftestStart(type, {});
    };

    const abortSmartTest = async () => {
        await smartInfo.SmartSelftestAbort({});
    };

    const actions = [
        <DropdownItem key="run-short-test"
                      isDisabled={smartSelftestStatus === "inprogress"}
                      onClick={() => { setKebabOpen(false); runSmartTest('short') }}>
            {_("Run short test")}
        </DropdownItem>,
        <DropdownItem key="run-extended-test"
                      isDisabled={smartSelftestStatus === "inprogress"}
                      onClick={() => { setKebabOpen(false); runSmartTest('extended') }}>
            {_("Run extended test")}
        </DropdownItem>,
        <DropdownItem key="run-conveyance-test"
                      isDisabled={smartSelftestStatus === "inprogress"}
                      onClick={() => { setKebabOpen(false); runSmartTest('conveyance') }}>
            {_("Run conveyance test")}
        </DropdownItem>,
    ];

    if (smartInfo.SmartSelftestStatus === "inprogress") {
        actions.push(
            <DropdownItem key="abort-smart-test"
                          onClick={() => { setKebabOpen(false); abortSmartTest('conveyance') }}>
                {_("Abort test")}
            </DropdownItem>,
        );
    }

    return (
        <Dropdown toggle={<KebabToggle onToggle={(_, isOpen) => setKebabOpen(isOpen)} />}
                isPlain
                isOpen={isKebabOpen}
                position="right"
                id="smart-actions"
                dropdownItems={actions} />
    );
};

export const SmartDetails = ({ smartInfo }) => {
    const SmartDetailRow = ({ title, value }) => {
        if (value === undefined)
            return null;

        return (
            <DescriptionListGroup>
                <DescriptionListTerm>{title}</DescriptionListTerm>
                <DescriptionListDescription>{value}</DescriptionListDescription>
            </DescriptionListGroup>
        );
    };

    return (
        <Card>
            <CardHeader actions={{ actions: <SmartActions smartInfo={smartInfo} /> }}>
                <CardTitle component="h2">{_("S.M.A.R.T")}</CardTitle>
            </CardHeader>
            <CardBody>
                <DescriptionList isHorizontal horizontalTermWidthModifier={{ default: '20ch' }}>
                    <SmartDetailRow title={_("Power on hours")} value={cockpit.format(_("$0 hours"), Math.round(smartInfo.SmartPowerOnSeconds / 3600))} />
                    <SmartDetailRow title={_("Last updated")} value={timeformat.dateTime(new Date(smartInfo.SmartUpdated * 1000))} />
                    <SmartDetailRow title={_("Smart selftest status")} value={selftestStatusDescription[smartInfo.SmartSelftestStatus]} />
                    <SmartDetailRow title={_("Number of bad sectors")} value={smartInfo.SmartNumBadSectors} />
                    <SmartDetailRow title={_("Atributes failing")} value={smartInfo.SmartNumAttributesFailing} />
                </DescriptionList>
            </CardBody>
        </Card>
    );
};
