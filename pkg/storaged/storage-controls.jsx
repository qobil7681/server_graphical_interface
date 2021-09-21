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

import React, { useState } from 'react';

import {
    Button, Dropdown, DropdownItem, DropdownToggle, KebabToggle,
    Tooltip, TooltipPosition,
    Progress, ProgressMeasureLocation, ProgressVariant,
    Switch,
} from '@patternfly/react-core';
import { BarsIcon } from '@patternfly/react-icons';

import cockpit from "cockpit";
import * as utils from "./utils.js";
import client from "./client.js";

import { dialog_open } from "./dialog.jsx";
import { fmt_to_fragments } from "./utilsx.jsx";

const _ = cockpit.gettext;

/* StorageControl - a button or similar that triggers
 *                  a privileged action.
 *
 * It can be disabled and will show a tooltip then.  It will
 * automatically disappear when the logged in user doesn't
 * have permission.
 *
 * Properties:
 *
 * - excuse:  If set, the button/link is disabled and will show the
 *            excuse in a tooltip.
 */

class StorageControl extends React.Component {
    render() {
        const excuse = this.props.excuse;
        if (!client.superuser.allowed)
            return <div />;

        if (excuse) {
            return (
                <Tooltip id="tip-storage" content={excuse}
                         position={this.props.excuse_placement || TooltipPosition.top}>
                    <span>
                        { this.props.content(excuse) }
                    </span>
                </Tooltip>
            );
        } else {
            return this.props.content();
        }
    }
}

function checked(callback) {
    return function (event) {
        if (!event)
            return;

        // only consider primary mouse button for clicks
        if (event.type === 'click' && event.button !== 0)
            return;

        // only consider enter button for keyboard events
        if (event.type === 'keypress' && event.key !== "Enter")
            return;

        const promise = client.run(callback);
        if (promise)
            promise.catch(function (error) {
                dialog_open({
                    Title: _("Error"),
                    Body: error.toString()
                });
            });
        event.stopPropagation();
    };
}

export const StorageButton = ({ id, kind, excuse, onClick, children, ariaLabel }) => (
    <StorageControl excuse={excuse}
                    content={excuse => (
                        <Button id={id}
                                aria-label={ariaLabel}
                                onClick={checked(onClick)}
                                variant={kind || "secondary"}
                                isDisabled={!!excuse}
                                style={excuse ? { pointerEvents: 'none' } : null}>
                            {children}
                        </Button>
                    )} />
);

export const StorageLink = ({ id, excuse, onClick, children }) => (
    <StorageControl excuse={excuse}
                    content={excuse => (
                        <Button onClick={checked(onClick)}
                                style={excuse ? { pointerEvents: 'none' } : null}
                                variant="link"
                                isInline
                                className="ct-form-relax"
                                isDisabled={!!excuse}>
                            {children}
                        </Button>
                    )} />
);

/* StorageBlockNavLink - describe a given block device concisely and
                         allow navigating to its details.

   Properties:

   - client
   - block
 */

export const StorageBlockNavLink = ({ client, block }) => {
    if (!block)
        return null;

    const parts = utils.get_block_link_parts(client, block.path);

    const link = (
        <Button isInline variant="link" onClick={() => { cockpit.location.go(parts.location) }}>
            {parts.link}
        </Button>
    );

    return <span>{fmt_to_fragments(parts.format, link)}</span>;
};

// StorageOnOff - OnOff switch for asynchronous actions.
//

export class StorageOnOff extends React.Component {
    constructor() {
        super();
        this.state = { promise: null };
    }

    render() {
        const self = this;

        function onChange(val) {
            const promise = self.props.onChange(val);
            if (promise) {
                promise.catch(error => {
                    dialog_open({
                        Title: _("Error"),
                        Body: error.toString()
                    });
                })
                        .finally(() => { self.setState({ promise: null }) });
            }

            self.setState({ promise: promise, promise_goal_state: val });
        }

        return (
            <StorageControl excuse={this.props.excuse}
                            content={(excuse) => (
                                <Switch isChecked={this.state.promise
                                    ? this.state.promise_goal_state
                                    : this.props.state}
                                                 aria-label={this.props['aria-label']}
                                                 isDisabled={!!(excuse || this.state.promise)}
                                                 onChange={onChange} />
                            )} />
        );
    }
}

/* Render a usage bar showing props.stats[0] out of props.stats[1]
 * bytes in use.  If the ratio is above props.critical, the bar will be
 * in a dangerous color.
 */

export const StorageUsageBar = ({ stats, critical, block }) => {
    if (!stats)
        return null;

    const fraction = stats[0] / stats[1];
    const labelText = utils.format_fsys_usage(stats[0], stats[1]);

    return (
        <Progress value={stats[0]} max={stats[1]}
            valueText={labelText}
            label={labelText}
            aria-label={cockpit.format(_("Usage of $0"), block)}
            variant={fraction > critical ? ProgressVariant.danger : ProgressVariant.info}
            measureLocation={ProgressMeasureLocation.outside} />
    );
};

export const StorageMenuItem = ({ onClick, children }) => (
    <DropdownItem onKeyPress={checked(onClick)} onClick={checked(onClick)}>{children}</DropdownItem>
);

export const StorageBarMenu = ({ label, isKebab, menuItems }) => {
    const [isOpen, setIsOpen] = useState(false);

    if (!client.superuser.allowed)
        return null;

    let toggle;
    if (isKebab)
        toggle = <KebabToggle onToggle={setIsOpen} />;
    else
        toggle = <DropdownToggle className="pf-m-primary" toggleIndicator={null}
                                 onToggle={setIsOpen} aria-label={label}>
            <BarsIcon color="white" />
        </DropdownToggle>;

    return (
        <Dropdown onSelect={() => setIsOpen(!isOpen)}
                  toggle={toggle}
                  isOpen={isOpen}
                  isPlain
                  position="right"
                  dropdownItems={menuItems} />
    );
};
