/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import React from 'react';
import PropTypes from 'prop-types';
import { FormGroup, FormSection, InputGroup, TextInput } from "@patternfly/react-core";

import * as Select from "cockpit-components-select.jsx";
import { units, digitFilter } from '../../helpers.js';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

const VolumeName = ({ idPrefix, volumeName, onValueChanged }) => {
    return (
        <FormGroup fieldId={`${idPrefix}-name`}
                   label={_("Name")}>
            <TextInput id={`${idPrefix}-name`}
                        minLength={1}
                        placeholder={_("New volume name")}
                        value={volumeName || ""}
                        onChange={value => onValueChanged('volumeName', value)} />
        </FormGroup>
    );
};

const VolumeDetails = ({ idPrefix, size, unit, format, storagePoolType, onValueChanged }) => {
    let formatRow;
    let validVolumeFormats;

    // For the valid volume format types for different pool types see https://libvirt.org/storage.html
    if (['disk'].indexOf(storagePoolType) > -1) {
        validVolumeFormats = [
            'none', 'linux', 'fat16', 'fat32', 'linux-swap', 'linux-lvm',
            'linux-raid', 'extended'
        ];
    } else if (['dir', 'fs', 'netfs', 'gluster', 'vstorage'].indexOf(storagePoolType) > -1) {
        validVolumeFormats = ['qcow2', 'raw'];
    }

    if (validVolumeFormats) {
        formatRow = (
            <FormGroup fieldId={`${idPrefix}-fileformat`} label={_("Format")}>
                <Select.Select id={`${idPrefix}-format`}
                    onChange={value => onValueChanged('format', value)}
                    initial={format}
                    extraClass='form-control ct-form-split'>
                    { validVolumeFormats.map(format => <Select.SelectEntry data={format} key={format}>{format}</Select.SelectEntry>) }
                </Select.Select>
            </FormGroup>
        );
    }

    return (
        <FormSection className="ct-form-split">
            <FormGroup fieldId={`${idPrefix}-size`}
                       label={_("Size")}>
                <InputGroup>
                    <TextInput id={`${idPrefix}-size`}
                               type="number" inputMode='numeric' pattern="[0-9]*"
                               value={parseFloat(size).toFixed(0)}
                               onKeyPress={digitFilter}
                               step={1}
                               min={0}
                               onChange={value => onValueChanged('size', value)} />
                    <Select.Select id={`${idPrefix}-unit`}
                                   initial={unit}
                                   onChange={value => onValueChanged('unit', value)}>
                        <Select.SelectEntry data={units.MiB.name} key={units.MiB.name}>
                            {_("MiB")}
                        </Select.SelectEntry>
                        <Select.SelectEntry data={units.GiB.name} key={units.GiB.name}>
                            {_("GiB")}
                        </Select.SelectEntry>
                    </Select.Select>
                </InputGroup>
            </FormGroup>
            {formatRow}
        </FormSection>
    );
};

export const VolumeCreateBody = ({ idPrefix, storagePool, onValueChanged, dialogValues }) => {
    return (
        <>
            <VolumeName idPrefix={idPrefix}
                        volumeName={dialogValues.volumeName}
                        onValueChanged={onValueChanged} />
            <VolumeDetails idPrefix={idPrefix}
                           size={dialogValues.size}
                           unit={dialogValues.unit}
                           format={dialogValues.format}
                           storagePoolType={storagePool.type}
                           onValueChanged={onValueChanged} />
        </>
    );
};

VolumeCreateBody.propTypes = {
    idPrefix: PropTypes.string.isRequired,
    storagePool: PropTypes.object.isRequired,
    onValueChanged: PropTypes.func.isRequired,
    dialogValues: PropTypes.object.isRequired,
};
