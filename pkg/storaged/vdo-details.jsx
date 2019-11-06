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
import React from "react";
import { Alert } from "@patternfly/react-core";
import { get_active_usage, teardown_active_usage, fmt_size, decode_filename } from "./utils.js";
import { dialog_open, SizeSlider, BlockingMessage, TeardownMessage } from "./dialog.jsx";
import { StdDetailsLayout } from "./details.jsx";
import { Block } from "./content-views.jsx";
import { StorageButton, StorageOnOff, StorageBlockNavLink } from "./storage-controls.jsx";

import inotify_py from "raw-loader!inotify.py";
import vdo_monitor_py from "raw-loader!./vdo-monitor.py";

const _ = cockpit.gettext;

export class VDODetails extends React.Component {
    constructor() {
        super();
        this.poll_path = null;
        this.state = { stats: null };
    }

    ensure_polling(enable) {
        var client = this.props.client;
        var vdo = this.props.vdo;
        var block = client.slashdevs_block[vdo.dev];
        var path = enable && block ? vdo.dev : null;

        var buf = "";

        if (this.poll_path === path)
            return;

        if (this.poll_path) {
            this.poll_process.close();
            this.setState({ stats: null });
        }

        if (path)
            this.poll_process = cockpit.spawn([client.vdo_overlay.python, "--", "-", path], { superuser: true })
                    .input(inotify_py + vdo_monitor_py)
                    .stream((data) => {
                        buf += data;
                        var lines = buf.split("\n");
                        buf = lines[lines.length - 1];
                        if (lines.length >= 2) {
                            this.setState({ stats: JSON.parse(lines[lines.length - 2]) });
                        }
                    });
        this.poll_path = path;
    }

    componentDidMount() {
        this.ensure_polling(true);
    }

    componentDidUpdate() {
        this.ensure_polling(true);
    }

    componentWillUnmount() {
        this.ensure_polling(false);
    }

    render() {
        var client = this.props.client;
        var vdo = this.props.vdo;
        var block = client.slashdevs_block[vdo.dev];
        var backing_block = client.slashdevs_block[vdo.backing_dev];

        function force_delete() {
            var location = cockpit.location;
            return vdo.force_remove().then(function () {
                location.go("/");
            });
        }

        if (vdo.broken) {
            var broken = (
                <Alert variant='danger' isInline title={
                    <>
                        <StorageButton onClick={force_delete}>{_("Remove device")}</StorageButton>
                        _("The creation of this VDO device did not finish and the device can't be used.")
                    </>} />
            );
            return <StdDetailsLayout client={this.props.client} alert={broken} />;
        }

        var alert = null;
        if (backing_block && backing_block.Size > vdo.physical_size)
            alert = (
                <Alert variant='warning' isInline title={
                    <div>
                        <div className="pull-right">
                            <StorageButton onClick={vdo.grow_physical}>{_("Grow to take all space")}</StorageButton>
                        </div>
                        {_("This VDO device does not use all of its backing device.")}
                    </div> }> {
                        cockpit.format(_("Only $0 of $1 are used."),
                                       fmt_size(vdo.physical_size),
                                       fmt_size(backing_block.Size))
                    } </Alert>
            );

        function stop() {
            var usage = get_active_usage(client, block ? block.path : "/");

            if (usage.Blocking) {
                dialog_open({
                    Title: cockpit.format(_("$0 is in active use"), vdo.name),
                    Body: BlockingMessage(usage),
                });
                return;
            }

            if (usage.Teardown) {
                dialog_open({
                    Title: cockpit.format(_("Please confirm stopping of $0"),
                                          vdo.name),
                    Body: TeardownMessage(usage),
                    Action: {
                        Title: _("Stop"),
                        action: function () {
                            return teardown_active_usage(client, usage)
                                    .then(function () {
                                        return vdo.stop();
                                    });
                        }
                    }
                });
            } else {
                return vdo.stop();
            }
        }

        function delete_() {
            var usage = get_active_usage(client, block ? block.path : "/");

            if (usage.Blocking) {
                dialog_open({
                    Title: cockpit.format(_("$0 is in active use"), vdo.name),
                    Body: BlockingMessage(usage),
                });
                return;
            }

            function wipe_with_teardown(block) {
                return block.Format("empty", { 'tear-down': { t: 'b', v: true } });
            }

            function teardown_configs() {
                if (block) {
                    return wipe_with_teardown(block);
                } else {
                    return vdo.start()
                            .then(function () {
                                return client.wait_for(() => client.slashdevs_block[vdo.dev])
                                        .then(function (block) {
                                            return wipe_with_teardown(block)
                                                    .catch(error => {
                                                        // systemd might have mounted it, let's try unmounting
                                                        const block_fsys = client.blocks_fsys[block.path];
                                                        if (block_fsys) {
                                                            return block_fsys.Unmount({})
                                                                    .then(() => wipe_with_teardown(block));
                                                        } else {
                                                            return Promise.reject(error);
                                                        }
                                                    });
                                        });
                            });
                }
            }

            dialog_open({
                Title: cockpit.format(_("Please confirm deletion of $0"),
                                      vdo.name),
                Body: TeardownMessage(usage),
                Action: {
                    Title: _("Delete"),
                    Danger: _("Deleting a VDO device will erase all data on it."),
                    action: function () {
                        return (teardown_active_usage(client, usage)
                                .then(teardown_configs)
                                .then(function () {
                                    var location = cockpit.location;
                                    return vdo.remove().then(function () {
                                        location.go("/");
                                    });
                                }));
                    }
                }
            });
        }

        function grow_logical() {
            dialog_open({
                Title: cockpit.format(_("Grow logical size of $0"), vdo.name),
                Fields: [
                    SizeSlider("lsize", _("Logical Size"),
                               {
                                   max: 5 * vdo.logical_size,
                                   min: vdo.logical_size,
                                   round: 512,
                                   value: vdo.logical_size,
                                   allow_infinite: true
                               })
                ],
                Action: {
                    Title: _("Grow"),
                    action: function (vals) {
                        if (vals.lsize > vdo.logical_size)
                            return vdo.grow_logical(vals.lsize).then(() => {
                                if (block && block.IdUsage == "filesystem")
                                    return cockpit.spawn(["fsadm", "resize",
                                        decode_filename(block.Device)],
                                                         { superuser: true });
                            });
                    }
                }
            });
        }

        function fmt_perc(num) {
            if (num || num == 0)
                return num + "%";
            else
                return "--";
        }

        var stats = this.state.stats;

        var header = (
            <div className="panel panel-default">
                <div className="panel-heading">
                    {cockpit.format(_("VDO Device $0"), vdo.name)}
                    <span className="pull-right">
                        { block
                            ? <StorageButton onClick={stop}>{_("Stop")}</StorageButton>
                            : <StorageButton onClick={vdo.start}>{_("Start")}</StorageButton>
                        }
                        { "\n" }
                        <StorageButton kind="danger" onClick={delete_}>{_("Delete")}</StorageButton>
                    </span>
                </div>
                <div className="panel-body">
                    <div className="ct-form">
                        <label className="control-label">{_("Device File")}</label>
                        <div>{vdo.dev}</div>

                        <label className="control-label">{_("Backing Device")}</label>
                        <div>
                            { backing_block ? <StorageBlockNavLink client={client} block={backing_block} />
                                : vdo.backing_dev
                            }
                        </div>

                        <label className="control-label">{_("Physical")}</label>
                        <div>
                            { stats
                                ? cockpit.format(_("$0 data + $1 overhead used of $2 ($3)"),
                                                 fmt_size(stats.dataBlocksUsed * stats.blockSize),
                                                 fmt_size(stats.overheadBlocksUsed * stats.blockSize),
                                                 fmt_size(vdo.physical_size),
                                                 fmt_perc(stats.usedPercent))
                                : fmt_size(vdo.physical_size)
                            }
                        </div>

                        <label className="control-label">{_("Logical")}</label>
                        <div>
                            { stats
                                ? cockpit.format(_("$0 used of $1 ($2 saved)"),
                                                 fmt_size(stats.logicalBlocksUsed * stats.blockSize),
                                                 fmt_size(vdo.logical_size),
                                                 fmt_perc(stats.savingPercent))
                                : fmt_size(vdo.logical_size)
                            }
                            &nbsp; <StorageButton onClick={grow_logical}>{_("Grow")}</StorageButton>
                        </div>

                        <label className="control-label">{_("Index Memory")}</label>
                        <div>{fmt_size(vdo.index_mem * 1024 * 1024 * 1024)}</div>

                        <label className="control-label">{_("Compression")}</label>
                        <div>
                            <StorageOnOff state={vdo.compression}
                                          onChange={() => vdo.set_compression(!vdo.compression)} />
                        </div>

                        <label className="control-label">{_("Deduplication")}</label>
                        <div>
                            <StorageOnOff state={vdo.deduplication}
                                           onChange={() => vdo.set_deduplication(!vdo.deduplication)} />
                        </div>
                    </div>
                </div>
            </div>
        );

        var content = <Block client={client} block={block} allow_partitions={false} />;

        return <StdDetailsLayout client={this.props.client}
                                 alert={alert}
                                 header={header}
                                 content={content} />;
    }
}
