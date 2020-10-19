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
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

import {
    Button,
    Toolbar, ToolbarContent, ToolbarItem,
    TextInput,
    Select, SelectOption, SelectVariant,
    Page, PageSection, PageSectionVariants,
} from '@patternfly/react-core';

import VmActions from './components/vm/vmActions.jsx';

import { vmId, rephraseUI, dummyVmsFilter } from "./helpers.js";

import { ListingTable } from "cockpit-components-table.jsx";
import StateIcon from './components/vm/stateIcon.jsx';
import { AggregateStatusCards } from "./components/aggregateStatusCards.jsx";

import "./hostvmslist.scss";

const VmState = ({ vm, resourceHasError }) => {
    let state = null;

    if (vm.installInProgress) {
        state = _("Creating VM installation");
    } else if (vm.createInProgress) {
        state = _("Creating VM");
    } else {
        state = vm.state;
    }

    const stateAlert = resourceHasError[vm.id] ? <span className='pficon-warning-triangle-o machines-status-alert' /> : null;

    return <StateIcon state={state} valueId={`${vmId(vm.name)}-state`} extra={stateAlert} />;
};

const _ = cockpit.gettext;

/**
 * List of all VMs defined on this host
 */
const HostVmsList = ({ vms, config, ui, storagePools, dispatch, actions, networks, resourceHasError, onAddErrorNotification }) => {
    const [statusSelected, setStatusSelected] = useState({ value: _("All"), toString: function() { return this.value } });
    const [currentTextFilter, setCurrentTextFilter] = useState("");
    const [statusIsExpanded, setStatusIsExpanded] = useState(false);
    const combinedVms = [...vms, ...dummyVmsFilter(vms, ui.vms)];
    const combinedVmsFiltered = combinedVms
            .filter(vm => vm.name.indexOf(currentTextFilter) != -1 && (!statusSelected.apiState || statusSelected.apiState == vm.state));

    const sortFunction = (vmA, vmB) => vmA.name.localeCompare(vmB.name);
    const toolBar = <Toolbar>
        <ToolbarContent>
            <ToolbarItem>
                <TextInput name="text-search" id="text-search" type="search"
                    value={currentTextFilter}
                    onChange={currentTextFilter => setCurrentTextFilter(currentTextFilter)}
                    placeholder={_("Filter by name")} />
            </ToolbarItem>
            <ToolbarItem variant="label" id="vm-state-select">
                {_("State")}
            </ToolbarItem>
            <ToolbarItem>
                <Select variant={SelectVariant.single}
                        toggleId="vm-state-select-toggle"
                        onToggle={statusIsExpanded => setStatusIsExpanded(statusIsExpanded)}
                        onSelect={(event, selection) => { setStatusIsExpanded(false); setStatusSelected(selection) }}
                        selections={statusSelected}
                        isOpen={statusIsExpanded}
                        aria-labelledby="vm-state-select">
                    {[
                        { value: _("All"), },
                        { value: _("Running"), apiState: "running" },
                        { value: _("Shut off"), apiState: "shut off" }
                    ].map((option, index) => (
                        <SelectOption key={index} value={{ ...option, toString: function() { return this.value } }} />
                    ))}
                </Select>
            </ToolbarItem>
            <ToolbarItem variant="separator" />
            <ToolbarItem>{actions}</ToolbarItem>
        </ToolbarContent>
    </Toolbar>;

    // table-hover class is needed till PF4 Table has proper support for clickable rows
    // https://github.com/patternfly/patternfly-react/issues/3267
    return (<Page>
        <PageSection id="virtual-machines-page-main-nav">
            <AggregateStatusCards networks={networks} storagePools={storagePools} />
        </PageSection>
        <PageSection variant={PageSectionVariants.light} id='virtual-machines-listing'>
            <ListingTable caption={_("Virtual machines")}
                variant='compact'
                emptyCaption={_("No VM is running or defined on this host")}
                actions={toolBar}
                columns={[
                    { title: _("Name"), header: true },
                    { title: _("Connection") },
                    { title: _("State") },
                    { title: _("") },
                ]}
                rows={ combinedVmsFiltered
                        .sort(sortFunction)
                        .map(vm => {
                            const vmActions = <VmActions
                                vm={vm}
                                config={config}
                                dispatch={dispatch}
                                storagePools={storagePools}
                                onAddErrorNotification={onAddErrorNotification}
                            />;

                            return {
                                extraClasses: resourceHasError[vm.id] ? ['error'] : [],
                                columns: [
                                    {
                                        title: <Button id={`${vmId(vm.name)}-${vm.connectionName}-name`}
                                                  variant="link"
                                                  isInline
                                                  isDisabled={vm.isUi}
                                                  component="a"
                                                  href={'#' + cockpit.format("vm?name=$0&connection=$1", vm.name, vm.connectionName)}
                                                  className="vm-list-item-name">{vm.name}</Button>
                                    },
                                    { title: rephraseUI('connections', vm.connectionName) },
                                    { title: <VmState vm={vm} resourceHasError={resourceHasError} /> },
                                    { title: !vm.isUi ? vmActions : null },
                                ],
                                rowId: cockpit.format("$0-$1", vmId(vm.name), vm.connectionName),
                                props: { key: cockpit.format("$0-$1-row", vmId(vm.name), vm.connectionName) },
                            };
                        }) }
            />
        </PageSection>
    </Page>);
};
HostVmsList.propTypes = {
    vms: PropTypes.array.isRequired,
    config: PropTypes.object.isRequired,
    ui: PropTypes.object.isRequired,
    storagePools: PropTypes.array.isRequired,
    dispatch: PropTypes.func.isRequired,
    resourceHasError: PropTypes.object.isRequired,
    onAddErrorNotification: PropTypes.func.isRequired,
};

export default HostVmsList;
