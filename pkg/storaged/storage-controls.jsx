/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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
import { OverlayTrigger, Tooltip } from "patternfly-react";
import { Progress, ProgressMeasureLocation, ProgressVariant } from '@patternfly/react-core';

import cockpit from "cockpit";
import * as utils from "./utils.js";
import client from "./client.js";

import { OnOffSwitch } from "cockpit-components-onoff.jsx";

import { dialog_open } from "./dialog.jsx";
import { fmt_to_fragments } from "./utilsx.jsx";

const _ = cockpit.gettext;

/* StorageControl - a button or similar that triggers
 *                  a privileged action.
 *
 * It can be disabled and will show a tooltip then.  It will
 * automatically disable itself when the logged in user doesn't
 * have permission.
 *
 * Properties:
 *
 * - excuse:  If set, the button/link is disabled and will show the
 *            excuse in a tooltip.
 */

class StorageControl extends React.Component {
    render() {
        var excuse = this.props.excuse;
        if (!client.permission.allowed) {
            var markup = {
                __html: cockpit.format(_("The user <b>$0</b> is not permitted to manage storage"),
                                       client.permission.user ? client.permission.user.name : '')
            };
            excuse = <span dangerouslySetInnerHTML={markup} />;
        }

        if (excuse) {
            return (
                <OverlayTrigger overlay={ <Tooltip id="tip-storage">{excuse}</Tooltip> }
                                placement={this.props.excuse_placement || "top"}>
                    <span>
                        { this.props.content(excuse) }
                    </span>
                </OverlayTrigger>
            );
        } else {
            return this.props.content();
        }
    }
}

function checked(callback) {
    return function (event) {
        // only consider primary mouse button
        if (!event || event.button !== 0)
            return;
        var promise = client.run(callback);
        if (promise)
            promise.fail(function (error) {
                dialog_open({
                    Title: _("Error"),
                    Body: error.toString()
                });
            });
        event.stopPropagation();
    };
}

export class StorageButton extends React.Component {
    render() {
        var classes = "pf-c-button";
        if (this.props.kind)
            classes += " pf-m-" + this.props.kind;
        else
            classes += " pf-m-secondary";

        return (
            <StorageControl excuse={this.props.excuse}
                            content={(excuse) => (
                                <button id={this.props.id}
                                            onClick={checked(this.props.onClick)}
                                            className={classes}
                                            style={excuse ? { pointerEvents: 'none' } : null}
                                            disabled={excuse}>
                                    {this.props.children}
                                </button>
                            )} />
        );
    }
}

export class StorageLink extends React.Component {
    render() {
        return (
            <StorageControl excuse={this.props.excuse}
                            content={(excuse) => (
                                <button onClick={checked(this.props.onClick)}
                                        style={excuse ? { pointerEvents: 'none' } : null}
                                        className="link-button ct-form-relax" disabled={excuse}>
                                    {this.props.children}
                                </button>
                            )} />
        );
    }
}

/* StorageBlockNavLink - describe a given block device concisely and
                         allow navigating to its details.

   Properties:

   - client
   - block
 */

export class StorageBlockNavLink extends React.Component {
    render() {
        var self = this;
        var client = self.props.client;
        var block = self.props.block;

        if (!block)
            return null;

        var parts = utils.get_block_link_parts(client, block.path);

        var link = (
            <button role="link" className="link-button" onClick={() => { cockpit.location.go(parts.location) }}>
                {parts.link}
            </button>
        );

        return <span>{fmt_to_fragments(parts.format, link)}</span>;
    }
}

// StorageOnOff - OnOff switch for asynchronous actions.
//

export class StorageOnOff extends React.Component {
    constructor() {
        super();
        this.state = { promise: null };
    }

    render() {
        var self = this;

        function onChange(val) {
            var promise = self.props.onChange(val);
            if (promise) {
                promise.always(() => { self.setState({ promise: null }) });
                promise.fail((error) => {
                    dialog_open({
                        Title: _("Error"),
                        Body: error.toString()
                    });
                });
            }

            self.setState({ promise: promise, promise_goal_state: val });
        }

        return (
            <StorageControl excuse={this.props.excuse}
                            content={(excuse) => (
                                <OnOffSwitch state={this.state.promise
                                    ? this.state.promise_goal_state
                                    : this.props.state}
                                                 disabled={!!(excuse || this.state.promise)}
                                                 style={(excuse || this.state.promise) ? { pointerEvents: 'none' } : null}
                                                 onChange={onChange} />
                            )} />
        );
    }
}

export class StorageMultiAction extends React.Component {
    render() {
        var dflt = this.props.actions[this.props.default];

        return (
            <StorageControl excuse={this.props.excuse}
                            content={(excuse) => {
                                var btn_classes = "pf-c-button pf-m-secondary";
                                return (
                                    <div className="btn-group">
                                        <button className={btn_classes} onClick={checked(dflt.action)} disabled={excuse}>
                                            {dflt.title}
                                        </button>
                                        <button className={btn_classes + " dropdown-toggle"}
                                                    data-toggle="dropdown">
                                            <span className="caret" />
                                        </button>
                                        <ul className="dropdown-menu action-dropdown-menu" role="menu">
                                            { this.props.actions.map((act) => (
                                                <li key={act.title} className="presentation">
                                                    <a role="menuitem" tabIndex="0" onClick={checked(act.action)}>
                                                        {act.title}
                                                    </a>
                                                </li>))
                                            }
                                        </ul>
                                    </div>
                                );
                            }} />
        );
    }
}

/* Render a usage bar showing props.stats[0] out of props.stats[1]
 * bytes in use.  If the ratio is above props.critical, the bar will be
 * in a dangerous color.
 */

export class StorageUsageBar extends React.Component {
    render() {
        var stats = this.props.stats;
        if (!stats)
            return null;

        var fraction = stats[0] / stats[1];
        var labelText = utils.format_fsys_usage(stats[0], stats[1]);

        return (
            <Progress value={stats[0]} max={stats[1]}
                valueText={labelText}
                label={labelText}
                variant={fraction > this.props.critical ? ProgressVariant.danger : ProgressVariant.info}
                measureLocation={ProgressMeasureLocation.outside} />
        );
    }
}

export class StorageMenuItem extends React.Component {
    render() {
        return <li><a onClick={checked(this.props.onClick)}>{this.props.children}</a></li>;
    }
}

export class StorageBarMenu extends React.Component {
    render() {
        const { children, label } = this.props;

        function toggle(excuse) {
            return (
                <button className="pf-c-button pf-m-primary" type="button" data-toggle="dropdown" aria-label={label} disabled={excuse}>
                    <span className="fa fa-bars" />
                </button>);
        }

        return (
            <div className="dropdown btn-group">
                <StorageControl content={toggle} excuse_placement="bottom" />
                <ul className="dropdown-menu dropdown-menu-right" role="menu">
                    {children}
                </ul>
            </div>);
    }
}
