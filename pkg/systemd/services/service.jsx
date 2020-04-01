/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

import React from "react";
import {
    Alert,
    Breadcrumb, BreadcrumbItem,
    Page, PageSection, PageSectionVariants,
} from '@patternfly/react-core';

import { ServiceDetails, ServiceTemplate } from "./service-details.jsx";
import { journal } from "journal";
import { systemd_manager } from "./services.jsx";

import $ from 'jquery';

import cockpit from "cockpit";

const _ = cockpit.gettext;
const permission = cockpit.permission({ admin: true });

export class Service extends React.Component {
    constructor(props) {
        super(props);

        this.updateLogBox = this.updateLogBox.bind(this);
        this.state = { error: undefined };
        this.getCurrentUnitTemplate = this.getCurrentUnitTemplate.bind(this);
        this.unitInstantiate = this.unitInstantiate.bind(this);

        this.getCurrentUnitTemplate();
    }

    componentDidMount() {
        this.updateLogBox();
    }

    componentDidUpdate() {
        this.updateLogBox();
    }

    updateLogBox() {
        if (this.cur_unit_is_template)
            return;

        if (this.props.unit.LoadState === "loaded" || this.props.unit.LoadState === "masked") {
            const cur_unit_id = this.props.unit.Id;
            this.cur_journal_watcher = journal.logbox(["_SYSTEMD_UNIT=" + cur_unit_id, "+",
                "COREDUMP_UNIT=" + cur_unit_id, "+",
                "UNIT=" + cur_unit_id], 10);

            $('#service-log')
                    .empty()
                    .append(this.cur_journal_watcher);
        }
    }

    getCurrentUnitTemplate() {
        const cur_unit_id = this.props.unit.Id;
        const tp = cur_unit_id.indexOf("@");
        const sp = cur_unit_id.lastIndexOf(".");

        this.cur_unit_is_template = (tp != -1 && (tp + 1 == sp || tp + 1 == cur_unit_id.length));

        if (tp != -1 && !this.cur_unit_is_template) {
            this.cur_unit_template = cur_unit_id.substring(0, tp + 1);
            if (sp != -1)
                this.cur_unit_template = this.cur_unit_template + cur_unit_id.substring(sp);
        }
    }

    /* See systemd-escape(1), used for instantiating templates.
     */
    systemd_escape(str) {
        function name_esc(str) {
            var validchars = /[0-9a-zA-Z:-_.\\]/;
            var res = "";
            var i;

            for (i = 0; i < str.length; i++) {
                var c = str[i];
                if (c == "/")
                    res += "-";
                else if (c == "-" || c == "\\" || !validchars.test(c)) {
                    res += "\\x";
                    var h = c.charCodeAt(0).toString(16);
                    while (h.length < 2)
                        h = "0" + h;
                    res += h;
                } else
                    res += c;
            }
            return res;
        }

        function kill_slashes(str) {
            str = str.replace(/\/+/g, "/");
            if (str.length > 1)
                str = str.replace(/\/$/, "").replace(/^\//, "");
            return str;
        }

        function path_esc(str) {
            str = kill_slashes(str);
            if (str == "/")
                return "-";
            else
                return name_esc(str);
        }

        if (str.length > 0 && str[0] == "/")
            return path_esc(str);
        else
            return name_esc(str);
    }

    unitInstantiate(param) {
        const cur_unit_id = this.props.unit.Id;

        if (cur_unit_id) {
            var tp = cur_unit_id.indexOf("@");
            var sp = cur_unit_id.lastIndexOf(".");
            if (tp != -1) {
                var s = cur_unit_id.substring(0, tp + 1);
                s = s + this.systemd_escape(param);
                if (sp != -1)
                    s = s + cur_unit_id.substring(sp);

                systemd_manager.call("StartUnit", [s, "fail"])
                        .done(() => setTimeout(() => cockpit.location.go([s]), 2000))
                        .fail(error => this.setState({ error: error.toString() }));
            }
        }
    }

    render() {
        let serviceDetails;
        if (this.cur_unit_is_template) {
            serviceDetails = (
                <ServiceTemplate template={this.props.unit.Id}
                                 instantiateCallback={this.unitInstantiate} />
            );
        } else {
            serviceDetails = (
                <ServiceDetails unit={this.props.unit}
                                originTemplate={this.cur_unit_template}
                                permitted={permission.allowed}
                                systemdManager={systemd_manager}
                                isValid={this.props.unitIsValid} />
            );
        }

        return (
            <Page id="service-details">
                <PageSection variant={PageSectionVariants.light}>
                    <Breadcrumb>
                        <BreadcrumbItem to='#'>{_("Services")}</BreadcrumbItem>
                        <BreadcrumbItem isActive>
                            {this.props.unit.Id}
                        </BreadcrumbItem>
                    </Breadcrumb>
                </PageSection>
                <PageSection variant={PageSectionVariants.light}>
                    {this.state.error && <Alert variant="danger" isInline title={this.state.error} />}
                    {serviceDetails}
                </PageSection>
                {!this.cur_unit_is_template && (this.props.unit.LoadState === "loaded" || this.props.unit.LoadState === "masked") &&
                <PageSection variant={PageSectionVariants.light}>
                    <div className="panel panel-default cockpit-log-panel" id="service-log-box" role="table" aria-describedby="service-log-box-heading">
                        <div className="panel-heading" id="service-log-box-heading">{_("Service Logs")}</div>
                        <div className="panel-body" id="service-log" role="rowgroup" />
                    </div>
                </PageSection>}
            </Page>
        );
    }
}
