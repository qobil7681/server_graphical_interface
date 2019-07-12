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
import "form-layout.less";
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';
import { Button } from 'patternfly-react';
import {
    Table,
    TableHeader,
    TableBody,
} from '@patternfly/react-table';

import { convertToUnit, diskPropertyChanged, toReadableNumber, units } from "../helpers.js";
import RemoveDiskAction from './diskRemove.jsx';
import { AddDiskModalBody } from './diskAdd.jsx';
import { getAllStoragePools } from '../actions/provider-actions.js';
import { EditDiskAction } from './diskEdit.jsx';
import WarningInactive from './warningInactive.jsx';

const _ = cockpit.gettext;

const StorageUnit = ({ value, id }) => {
    if (!value) {
        return null;
    }

    if (isNaN(value)) {
        return (
            <div id={id}>
                {value}
            </div>
        );
    }

    return (
        <div id={id}>
            {toReadableNumber(convertToUnit(value, units.B, units.GiB))}&nbsp;{_("GiB")}
        </div>
    );
};

const VmDiskCell = ({ value, id }) => {
    return (
        <div id={id}>
            {value}
        </div>
    );
};

class VmDisksTab extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            showModal: false,
        };
        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
    }

    close() {
        this.setState({ showModal: false });
    }

    open() {
        // Refresh storage volume list before displaying the dialog.
        // There are recently no Libvirt events for storage volumes and polling is ugly.
        // https://bugzilla.redhat.com/show_bug.cgi?id=1578836
        this.props.dispatch(getAllStoragePools(this.props.vm.connectionName))
                .then(() => {
                    this.setState({ showModal: true });
                });
    }

    render() {
        const { idPrefix, vm, disks, renderCapacity, dispatch, provider, onAddErrorNotification, storagePools } = this.props;
        const actions = (
            <>
                <Button id={`${idPrefix}-adddisk`} bsStyle='primary' onClick={this.open} className='pull-right'>
                    {_("Add Disk")}
                </Button>
                {this.state.showModal && <AddDiskModalBody close={this.close} dispatch={dispatch} idPrefix={idPrefix} vm={vm} storagePools={storagePools} provider={provider} />}
            </>
        );
        const columnTitles = [_("Device")];
        let renderCapacityUsed, renderAccess, renderAdditional;

        if (disks && disks.length > 0) {
            renderCapacityUsed = !!disks.find(disk => (!!disk.used));
            renderAccess = !!disks.find(disk => (typeof disk.readonly !== "undefined") || (typeof disk.shareable !== "undefined"));
            renderAdditional = !!disks.find(disk => (!!disk.diskExtras));

            if (renderCapacity) {
                if (renderCapacityUsed) {
                    columnTitles.push(_("Used"));
                }
                columnTitles.push(_("Capacity"));
            }
            columnTitles.push(_("Bus"));
            if (renderAccess) {
                columnTitles.push(_("Access"));
            }
            columnTitles.push(_("Source"));
            if (renderAdditional)
                columnTitles.push(_("Additional"));
            columnTitles.push({ title: actions });
        } else {
            return (
                <>
                    {_("No disks defined for this VM")}
                    {actions}
                </>
            );
        }

        const rows = disks.map(disk => {
            const idPrefixRow = `${idPrefix}-${disk.target || disk.device}`;
            const columns = [
                { title: <VmDiskCell value={disk.device} id={`${idPrefixRow}-device`} key={`${idPrefixRow}-device`} /> },
            ];

            if (renderCapacity) {
                if (renderCapacityUsed) {
                    columns.push({ title: <StorageUnit value={disk.used} id={`${idPrefixRow}-used`} key={`${idPrefixRow}-used`} /> });
                }
                columns.push({ title: <StorageUnit value={disk.capacity} id={`${idPrefixRow}-capacity`} key={`${idPrefixRow}-capacity`} /> });
            }

            columns.push({ title: <VmDiskCell value={disk.bus} id={`${idPrefixRow}-bus`} key={`${idPrefixRow}-bus`} /> });

            if (renderAccess) {
                const access = (
                    <span id={`${idPrefixRow}-access`}>
                        { disk.readonly ? _("Read-only") : disk.shareable ? _("Writeable and shared") : _("Writeable") }
                        { vm.state === "running" &&
                        (diskPropertyChanged(vm, disk.target, "readonly") || diskPropertyChanged(vm, disk.target, "shareable")) &&
                            <WarningInactive iconId={`${idPrefixRow}-access-tooltip`} tooltipId={`tip-${idPrefixRow}-access`} /> }
                    </span>
                );
                columns.push(access);
            }

            columns.push({ title: disk.diskSourceCell });
            if (renderAdditional)
                columns.push({ title: disk.diskExtras || '' });

            if (provider.name === 'LibvirtDBus') {
                const diskActions = (
                    <div className='machines-listing-actions'>
                        <RemoveDiskAction dispatch={dispatch}
                            vm={vm}
                            target={disk.target}
                            idPrefixRow={idPrefixRow}
                            onAddErrorNotification={onAddErrorNotification} />
                        { vm.inactiveXML.disks[disk.target] && // supported only  for persistent disks
                        <EditDiskAction disk={disk}
                            vm={vm}
                            provider={provider}
                            idPrefix={idPrefixRow}
                            onAddErrorNotification={onAddErrorNotification} /> }
                    </div>
                );
                columns.push({ title: diskActions });
            }

            return columns;
        });

        return (
            <Table variant='compact'
                aria-label={`VM ${vm.name} Disks`}
                cells={columnTitles}
                rows={rows}>
                <TableHeader />
                <TableBody />
            </Table>
        );
    }
}

VmDisksTab.propTypes = {
    idPrefix: PropTypes.string.isRequired,
    disks: PropTypes.array.isRequired,
    renderCapacity: PropTypes.bool,
    provider: PropTypes.object,
    onAddErrorNotification: PropTypes.func.isRequired,
};

export default VmDisksTab;
