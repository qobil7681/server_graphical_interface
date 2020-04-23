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
import ReactDOM from 'react-dom';
import {
    Button,
    Bullseye,
    Page, PageSection, PageSectionVariants,
    TextInput,
    Card,
} from '@patternfly/react-core';
import {
    DataToolbar,
    DataToolbarItem,
    DataToolbarGroup,
    DataToolbarContent,
} from '@patternfly/react-core/dist/esm/experimental';
import { SearchIcon } from '@patternfly/react-icons';

import * as Select from "cockpit-components-select.jsx";
import { Privileged } from "cockpit-components-privileged.jsx";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { Service } from "./service.jsx";
import { ServiceTabs, service_tabs_suffixes } from "./service-tabs.jsx";
import { ServicesList } from "./services-list.jsx";
import { onCreateTimer, timerDialogSetup } from "./timer-dialog.js";
import moment from "moment";
import { page_status } from "notifications";
import cockpit from "cockpit";

moment.locale(cockpit.language);

const _ = cockpit.gettext;

export const systemd_client = cockpit.dbus("org.freedesktop.systemd1", { superuser: "try" });
export const systemd_manager = systemd_client.proxy("org.freedesktop.systemd1.Manager",
                                                    "/org/freedesktop/systemd1");
const timedate_client = cockpit.dbus('org.freedesktop.timedate1');
export let clock_realtime_now;
export let clock_monotonic_now;

export function updateTime() {
    cockpit.spawn(["cat", "/proc/uptime"])
            .then(function(contents) {
                // first number is time since boot in seconds with two fractional digits
                const uptime = parseFloat(contents.split(' ')[0]);
                clock_monotonic_now = parseInt(uptime * 1000000, 10);
            }, ex => console.log(ex));
    cockpit.spawn(["date", "+%s"])
            .then(function(time) {
                clock_realtime_now = moment.unix(parseInt(time));
            }, ex => console.log(ex));
}

/* Notes about the systemd D-Bus API
 *
 * - One can use an object path for a unit that isn't currently
 *   loaded.  Doing so will load the unit (and emit UnitNew).
 *
 * - Calling o.fd.DBus.GetAll might thus trigger a UnitNew signal,
 *   so calling GetAll as a reaction to UnitNew might lead to
 *   infinite loops.
 *
 * - To avoid this cycle, we only call GetAll when there is some
 *   job activity for a unit, or when the whole daemon is
 *   reloaded.  The idea is that without jobs or a full reload,
 *   the state of a unit will not change in an interesting way.
 *
 * - We hope that the cache machinery in cockpit-bridge does not
 *   trigger such a cycle when watching a unit.
 *
 * - JobNew and JobRemoved signals don't include the object path
 *   of the affected units, but we can get those by listening to
 *   UnitNew.
 *
 * - There might be UnitNew signals for units that are never
 *   returned by ListUnits or ListUnitFiles.  These are units that
 *   are mentioned in Requires, After, etc or that people try to
 *   load via LoadUnit but that don't actually exist.
 *
 * - ListUnitFiles will return unit files that are aliases for
 *   other unit files, but ListUnits will not return aliases.
 *
 * - The "Names" property of a unit only includes those aliases
 *   that are currently loaded, not all.  To get all possible
 *   aliases, one needs to call ListUnitFiles and match units via
 *   their object path.
 *
 * - The unit file state of a alias as returned by ListUnitFiles
 *   is always the same as the unit file state of the primary unit
 *   file.
 *
 * - However, the unit file state as returned by ListUnitFiles is
 *   not necessarily the same as the UnitFileState property of a
 *   loaded unit.  ListUnitFiles reflects the state of the files
 *   on disk, while a loaded unit is only updated to that state
 *   via an explicit Reload.
 *
 * - Thus, we are careful to only use the UnitFileState as
 *   returned by ListUnitFiles or GetUnitFileState.  The
 *   alternative would be to only use the UnitFileState property,
 *   but we need one method call per unit to get them all for the
 *   overview, which seems excessive.
 *
 * - Methods like EnableUnitFiles only change the state of files
 *   on disk.  A Reload is necessary to update the state
 *   of loaded units.
 *
 * - A Reload will emit UnitRemoved/UnitNew signals for all units,
 *   and no PropertiesChanges signal for the properties that have
 *   changed because of the reload, such as UnitFileState.
 *
 */
class ServicesPage extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            /* State related to the toolbar/tabs components */
            activeTab: 'service',
            stateDropdownIsExpanded: false,
            currentTypeFilter: null,
            currentTextFilter: '',

            unit_by_path: {},
            loadingUnits: true,
            privileged: true,
            path: cockpit.location.path,
            tabErrors: {},
        };
        /* Functions for controlling the toolbar's components */
        this.onClearAllFilters = this.onClearAllFilters.bind(this);
        this.onTypeDropdownSelect = this.onTypeDropdownSelect.bind(this);
        this.onInputChange = this.onInputChange.bind(this);

        /* Function for manipulating with the API results and store the units in the React state */
        this.processFailedUnits = this.processFailedUnits.bind(this);
        this.getUnitByPath = this.getUnitByPath.bind(this);
        this.updateProperties = this.updateProperties.bind(this);
        this.addTimerProperties = this.addTimerProperties.bind(this);
        this.updateComputedProperties = this.updateComputedProperties.bind(this);
        this.compareUnits = this.compareUnits.bind(this);

        this.permission = cockpit.permission({ admin: true });
        this.onPermissionChanged = this.onPermissionChanged.bind(this);

        this.seenPaths = new Set();
        this.path_by_id = {};
        this.state_by_id = {};
        this.operationInProgress = {};

        this.getLoadingInProgress = this.getLoadingInProgress.bind(this);
        this.on_navigate = this.on_navigate.bind(this);
    }

    componentDidMount() {
        /* Listen for permission changes for "Create Timer" button */
        this.permission.addEventListener("changed", this.onPermissionChanged);
        this.onPermissionChanged();

        cockpit.addEventListener("locationchanged", this.on_navigate);
        this.on_navigate();

        /* Prepare the "Create Timer" dialog - TODO: this needs to be rewritten in React */
        timerDialogSetup();

        systemd_manager.wait(() => {
            if (systemd_manager.valid) {
                this.systemd_subscription = systemd_manager.Subscribe()
                        .catch(error => {
                            if (error.name != "org.freedesktop.systemd1.AlreadySubscribed" &&
                            error.name != "org.freedesktop.DBus.Error.FileExists")
                                console.warn("Subscribing to systemd signals failed", error);
                        });
                this.listUnits();
            } else {
                console.warn("Connecting to systemd failed");
            }
        });

        cockpit.addEventListener("visibilitychange", () => {
            if (!cockpit.hidden)
                this.listUnits();
        });

        /* Start listening to signals for updates - when in the middle of reload mute all signals
         * - We don't need to listen to 'UnitFilesChanged' signal since everytime we
         *   perform some file operation we do call Reload which issues 'Reload' signal
         * - JobNew is also useless, JobRemoved is enough since it comes in pair with JobNew
         *   but we are interested to update the state when the operation finished
         */
        systemd_client.subscribe({
            interface: "org.freedesktop.DBus.Properties",
            member: "PropertiesChanged"
        }, (path, iface, signal, args) => {
            if (this.getLoadingInProgress())
                return;

            this.updateProperties(args[1], path);
            this.processFailedUnits();
        });

        ["JobNew", "JobRemoved"].forEach(signalType => {
            systemd_manager.addEventListener(signalType, (event, number, job, unit_id, result) => {
                if (this.getLoadingInProgress())
                    return;

                systemd_manager.LoadUnit(unit_id)
                        .then(path => {
                            if (!this.seenPaths.has(path)) {
                                this.seenPaths.add(path);
                                this.path_by_id[unit_id] = path;
                            }

                            this.getUnitByPath(path).then(this.processFailedUnits);
                        });
            });
        });

        systemd_manager.addEventListener("Reloading", (event, reloading) => {
            const currentlyLoading = this.getLoadingInProgress();

            if (!reloading && !currentlyLoading)
                this.listUnits();
        });

        this.timedated_subscription = timedate_client.subscribe({
            interface: "org.freedesktop.DBus.Properties",
            member: "PropertiesChanged"
        }, updateTime);
        updateTime();
    }

    componentWillUnmount() {
        cockpit.removeEventListener("locationchanged", this.on_navigate);
    }

    shouldComponentUpdate(nextProps, nextState) {
        /*
         * Filter out some re-render, otherwise at the initial loading where all the units are loaded one by one
         * there are too many re-renders happening which seems to freeze little bit the initial loading phase
         * Generally React is supposed to batch the setState calls but in this case it seems to not happen since the API
         * call results have time delay between one another
         */
        if (cockpit.hidden ||
           (nextState.loadingUnits === true && this.state.loadingUnits === true) ||
           (this.seenPaths.size == 0 || this.seenPaths.size > Object.keys(nextState.unit_by_path).length))
            return false;
        return true;
    }

    getLoadingInProgress() {
        return !cockpit.hidden && (this.state.loadingUnits || (this.seenPaths.size == 0 || this.seenPaths.size > Object.keys(this.state.unit_by_path).length));
    }

    on_navigate() {
        const newState = { path: cockpit.location.path };
        if (cockpit.location.options && cockpit.location.options.type)
            newState.activeTab = cockpit.location.options.type;
        this.setState(newState);
    }

    /**
      * Return a boolean value indicating if the unit specified by name @param is handled
      */
    isUnitHandled(name) {
        const suffix = name.substr(name.lastIndexOf('.') + 1);
        return Object.keys(service_tabs_suffixes).includes(suffix);
    }

    /* When the page is running in the background fetch only information about failed units
     * in order to update the 'Page Status'. The whole listUnits is very expensive.
     * We still need to maintain the 'unit_by_path' state object so that if we receive
     * some signal we can normally parse it and update only the affected unit state
     * instead of calling ListUnitsFiltered API call for every received signal which
     * might have changed the failed units array
     */
    listFailedUnits() {
        return systemd_manager.ListUnitsFiltered(["failed"])
                .then(failed => {
                    failed.forEach(result => {
                        const path = result[6];
                        const unit_id = result[0];

                        if (!this.isUnitHandled(unit_id))
                            return;

                        if (!this.seenPaths.has(path)) {
                            this.seenPaths.add(path);
                            this.path_by_id[unit_id] = path;
                        }

                        this.updateProperties(
                            {
                                Id: cockpit.variant("s", unit_id),
                                Description: cockpit.variant("s", result[1]),
                                LoadState: cockpit.variant("s", result[2]),
                                ActiveState: cockpit.variant("s", result[3]),
                                SubState: cockpit.variant("s", result[4]),
                            }, path
                        );
                    });
                    this.processFailedUnits();
                }, ex => console.warn('ListUnitsFiltered failed: ', ex.toString()));
    }

    listUnits() {
        function isTemplate(id) {
            const tp = id.indexOf("@");
            const sp = id.lastIndexOf(".");
            return (tp != -1 && (tp + 1 == sp || tp + 1 == id.length));
        }
        if (!systemd_manager.valid)
            return;

        if (cockpit.hidden)
            return this.listFailedUnits();

        // Reinitialize the state variables for the units
        this.setState({ unit_by_path: {}, loadingUnits: true });
        this.seenPaths = new Set();

        const promisesLoad = [];

        // Run ListUnits before LIstUnitFiles so that we avoid the extra LoadUnit calls
        // Now we call LoadUnit only for those that ListUnits didn't tell us about
        systemd_manager.ListUnits()
                .then(results => {
                    results.forEach(result => {
                        const path = result[6];
                        const unit_id = result[0];

                        if (!this.isUnitHandled(unit_id))
                            return;

                        if (!this.seenPaths.has(path)) {
                            this.seenPaths.add(path);
                            this.path_by_id[unit_id] = path;
                        }

                        this.updateProperties(
                            {
                                Id: cockpit.variant("s", unit_id),
                                Description: cockpit.variant("s", result[1]),
                                LoadState: cockpit.variant("s", result[2]),
                                ActiveState: cockpit.variant("s", result[3]),
                                SubState: cockpit.variant("s", result[4]),
                            }, path
                        );
                    });
                    systemd_manager.ListUnitFiles()
                            .then(results => {
                                results.forEach(result => {
                                    const unit_path = result[0];
                                    const unit_id = unit_path.split('/').pop();
                                    const unitFileState = result[1];

                                    this.state_by_id[unit_id] = unitFileState;

                                    if (!this.isUnitHandled(unit_id))
                                        return;

                                    if (this.seenPaths.has(this.path_by_id[unit_id])) {
                                        this.updateProperties(
                                            {
                                                Id: cockpit.variant("s", unit_id),
                                                UnitFileState: cockpit.variant("s", unitFileState)
                                            }, this.path_by_id[unit_id]);
                                        return;
                                    }

                                    if (isTemplate(unit_id)) {
                                        // Remove ".service" from services as this is not necessary
                                        let shortId = unit_id;
                                        if (unit_id.endsWith(".service"))
                                            shortId = unit_id.substring(0, unit_id.length - 8);

                                        // A template, create a fake unit for it
                                        this.setState({
                                            unit_by_path: {
                                                ...this.state.unit_by_path,
                                                [unit_id]: {
                                                    path: unit_id,
                                                    Id: unit_id,
                                                    shortId: shortId,
                                                    Description: cockpit.format(_("$0 Template"), unit_id),
                                                    UnitFileState: unitFileState,
                                                    is_timer: (unit_id.slice(-5) == "timer"),
                                                    is_template: true
                                                }
                                            }
                                        });
                                        this.path_by_id[unit_id] = unit_id;
                                        this.seenPaths.add(unit_id);
                                        return;
                                    }

                                    promisesLoad.push(systemd_manager.LoadUnit(unit_id).catch(ex => console.warn(ex)));
                                });

                                Promise.all(promisesLoad)
                                        .then(result => {
                                            // First add the path in the seens paths to maintain the loading state
                                            result.forEach(path => this.seenPaths.add(path));

                                            return Promise.all(result.map(path => this.getUnitByPath(path)));
                                        })
                                        .finally(() => {
                                            this.setState({ loadingUnits: false });
                                            this.processFailedUnits();
                                        });
                            }, ex => console.warn('ListUnitFiles failed: ', ex.toString()));
                }, ex => console.warn('ListUnits failed: ', ex.toString()));
    }

    onPermissionChanged() {
        // default to allowed while not yet initialized
        this.setState({ privileged: this.permission.allowed !== false });
    }

    onClearAllFilters() {
        this.setState({ currentTextFilter: '', currentTypeFilter: null });
    }

    onInputChange(newValue) {
        this.setState({ currentTextFilter: newValue });
    }

    onTypeDropdownSelect(currentTypeFilter) {
        this.setState({ currentTypeFilter });
    }

    /**
      * Sort units by alphabetically - failed units go on the top of the list
      */
    compareUnits(unit_a, unit_b) {
        const failed_a = unit_a.HasFailed ? 1 : 0;
        const failed_b = unit_b.HasFailed ? 1 : 0;

        if (!unit_a || !unit_b)
            return false;

        if (failed_a != failed_b)
            return failed_b - failed_a;
        else
            return unit_a.Id.localeCompare(unit_b.Id);
    }

    addTimerProperties(timer_unit, path) {
        const unit = Object.assign({}, this.state.unit_by_path[path]);

        unit.LastTriggerTime = moment(timer_unit.LastTriggerUSec / 1000).calendar();
        const system_boot_time = clock_realtime_now.valueOf() * 1000 - clock_monotonic_now;
        if (timer_unit.LastTriggerUSec === -1 || timer_unit.LastTriggerUSec === 0)
            unit.LastTriggerTime = _("unknown");
        let next_run_time = 0;
        if (timer_unit.NextElapseUSecRealtime === 0)
            next_run_time = timer_unit.NextElapseUSecMonotonic + system_boot_time;
        else if (timer_unit.NextElapseUSecMonotonic === 0)
            next_run_time = timer_unit.NextElapseUSecRealtime;
        else {
            if (timer_unit.NextElapseUSecMonotonic + system_boot_time < timer_unit.NextElapseUSecRealtime)
                next_run_time = timer_unit.NextElapseUSecMonotonic + system_boot_time;
            else
                next_run_time = timer_unit.NextElapseUSecRealtime;
        }
        unit.NextRunTime = moment(next_run_time / 1000).calendar();
        if (timer_unit.NextElapseUSecMonotonic <= 0 && timer_unit.NextElapseUSecRealtime <= 0)
            unit.NextRunTime = _("unknown");

        this.setState(prevState => ({
            unit_by_path: {
                ...prevState.unit_by_path,
                [unit.path]: unit,
            }
        }));
    }

    /* Add some computed properties into a unit object - does not call setState */
    updateComputedProperties(unit) {
        let load_state = unit.LoadState;
        const active_state = unit.ActiveState;

        if (load_state == "loaded")
            load_state = "";

        unit.HasFailed = (active_state == "failed" || (load_state !== "" && load_state != "masked"));

        if (active_state === "active" || active_state === "activating")
            unit.CombinedState = _("Running");
        else if (active_state == "failed")
            unit.CombinedState = _("Failed to start");
        else
            unit.CombinedState = _("Not running");

        unit.AutomaticStartup = "";
        if (unit.UnitFileState && unit.UnitFileState.indexOf('enabled') == 0) {
            unit.AutomaticStartup = _("Enabled");
            unit.AutomaticStartupKey = 'enabled';
        } else if (unit.UnitFileState && unit.UnitFileState.indexOf('disabled') == 0) {
            unit.AutomaticStartup = _("Disabled");
            unit.AutomaticStartupKey = 'disabled';
        } else if (unit.UnitFileState && unit.UnitFileState.indexOf('static') == 0) {
            unit.AutomaticStartup = _("Static");
            unit.AutomaticStartupKey = 'static';
        } else if (unit.UnitFileState && unit.UnitFileState.indexOf('masked') == 0) {
            unit.AutomaticStartup = _("Masked");
        }

        if (load_state !== "" && load_state != "masked")
            unit.CombinedState = cockpit.format("$0 ($1)", unit.CombinedState, _(load_state));

        unit.shortId = unit.Id;
        // Remove ".service" from services as this is not necessary
        if (unit.Id.endsWith(".service"))
            unit.shortId = unit.Id.substring(0, unit.Id.length - 8);
    }

    updateProperties(props, path) {
        // We received a request to update properties on a unit we are not yet aware off
        if (!this.state.unit_by_path[path] && !props.Id)
            return;

        let shouldUpdate = false;
        const unitNew = Object.assign({}, this.state.unit_by_path[path]);
        const prop = p => {
            if (props[p]) {
                shouldUpdate = true;
                unitNew[p] = props[p].v;
            }
        };

        prop("Id");
        prop("Description");
        prop("Names");
        prop("LoadState");
        prop("LoadError");
        prop("ActiveState");
        prop("SubState");
        prop("UnitFileState");
        prop("FragmentPath");
        unitNew.path = path;

        prop("Requires");
        prop("Requisite");
        prop("Wants");
        prop("BindsTo");
        prop("PartOf");
        prop("RequiredBy");
        prop("RequisiteOf");
        prop("WantedBy");
        prop("BoundBy");
        prop("ConsistsOf");
        prop("Conflicts");
        prop("ConflictedBy");
        prop("Before");
        prop("After");
        prop("OnFailure");
        prop("Triggers");
        prop("TriggeredBy");
        prop("PropagatesReloadTo");
        prop("PropagatesReloadFrom");
        prop("JoinsNamespaceOf");
        prop("Conditions");
        prop("CanReload");

        prop("ActiveEnterTimestamp");

        if (!shouldUpdate)
            return;

        this.updateComputedProperties(unitNew);

        this.setState(prevState => ({
            unit_by_path: {
                ...prevState.unit_by_path,
                [path]: unitNew,
            }
        }));

        if (unitNew.Id.slice(-5) == "timer") {
            unitNew.is_timer = true;
            if (unitNew.ActiveState == "active") {
                const timer_unit = systemd_client.proxy('org.freedesktop.systemd1.Timer', unitNew.path);
                timer_unit.wait(() => {
                    if (timer_unit.valid)
                        this.addTimerProperties(timer_unit, path);
                });
            }
        }
    }

    /**
      * Fetches all Properties for the unit specified by path @param and add the unit to the state
      */
    getUnitByPath(path) {
        return systemd_client.call(path,
                                   "org.freedesktop.DBus.Properties", "GetAll",
                                   ["org.freedesktop.systemd1.Unit"])
                .fail(error => {
                    console.warn('GetAll failed for', path, error);
                })
                .then(result => {
                    this.updateProperties(result[0], path);
                });
    }

    processFailedUnits() {
        const failed = new Set();
        const tabErrors = { };

        for (const p in this.state.unit_by_path) {
            const u = this.state.unit_by_path[p];
            if (u.ActiveState == "failed") {
                const suffix = u.Id.substr(u.Id.lastIndexOf('.') + 1);
                if (Object.keys(service_tabs_suffixes).includes(suffix)) {
                    tabErrors[suffix] = true;
                    failed.add(u.Id);
                }
            }
        }
        this.setState({ tabErrors });

        if (failed.size > 0) {
            page_status.set_own({
                type: "error",
                title: cockpit.format(cockpit.ngettext("$0 service has failed",
                                                       "$0 services have failed",
                                                       failed.size), failed.size),
                details: [...failed]
            });
        } else {
            page_status.set_own(null);
        }
    }

    render() {
        const { path, unit_by_path } = this.state;

        if (this.state.loadingUnits || this.seenPaths.size > Object.keys(this.state.unit_by_path).length)
            return <EmptyStatePanel loading title={_("Loading...")} />;

        /* Perform navigation */
        if (path.length == 1) {
            const unit_id = path[0];
            const get_unit_path = (unit_id) => Object.keys(this.state.unit_by_path).find(path => this.state.unit_by_path[path].Id == unit_id);
            const unit_path = get_unit_path(unit_id);

            if (unit_path === undefined)
                return null;

            const unit = this.state.unit_by_path[unit_path];
            return <Service unitIsValid={unitId => { const path = get_unit_path(unitId); return path !== undefined && this.state.unit_by_path[path].LoadState != 'not-found' }}
                            key={unit_id}
                            getUnitByPath={this.getUnitByPath}
                            unit={unit} />;
        }

        const typeDropdownOptions = [
            { key: 'all', value: _("All") },
            { key: 'enabled', value: _("Enabled") },
            { key: 'disabled', value: _("Disabled") },
            { key: 'static', value: _("Static") },
        ];
        const { currentTextFilter, activeTab } = this.state;
        const currentTypeFilter = this.state.currentTypeFilter || typeDropdownOptions[0];

        const units = Object.keys(unit_by_path)
                .map(path => unit_by_path[path])
                .filter(unit => {
                    if (!(unit.Id && activeTab && unit.Id.match(cockpit.format(".$0$", activeTab))))
                        return false;

                    if (unit.LoadState == "not-found")
                        return false;

                    if (currentTextFilter && unit.Description && unit.Description.toLowerCase().indexOf(currentTextFilter) == -1 &&
                        unit.Id.indexOf(currentTextFilter) == -1)
                        return false;

                    if (currentTypeFilter.key !== 'all' && currentTypeFilter.key !== unit.AutomaticStartupKey)
                        return false;

                    return true;
                })
                .sort(this.compareUnits);

        const toolbarItems = <>
            <DataToolbarGroup>
                <DataToolbarItem variant="label" id="services-text-filter-label">{_("Filter")}</DataToolbarItem>
                <DataToolbarItem variant="search-filter">
                    <TextInput name="services-text-filter"
                            id="services-text-filter"
                            type="search"
                            value={currentTextFilter}
                            onChange={this.onInputChange}
                            aria-labelledby="services-text-filter-label"
                            placeholder={_("Filter by name or description")} />
                </DataToolbarItem>
                <DataToolbarItem variant="search-filter">
                    <Select.StatelessSelect id="services-dropdown"
                            selected={currentTypeFilter.key}
                            onChange={value => this.onTypeDropdownSelect(typeDropdownOptions.find(option => option.key == value))}>
                        {typeDropdownOptions.map(option => (
                            <Select.SelectEntry key={option.key} data={option.key}>
                                {option.value}
                            </Select.SelectEntry>
                        ))}
                    </Select.StatelessSelect>
                </DataToolbarItem>
            </DataToolbarGroup>
            {activeTab == "timer" &&
            <>
                <DataToolbarItem variant="separator" />
                <DataToolbarItem>
                    <Privileged key="create-timer-privileged"
                                allowed={ this.state.privileged }
                                excuse={ cockpit.format(_("The user $0 is not permitted to create timers"),
                                                        this.permission.user ? this.permission.user.name : '') }>
                        <Button key='create-timer-action' variant="secondary"
                                id="create-timer"
                                onClick={onCreateTimer}>{_("Create Timer")}</Button>
                    </Privileged>
                </DataToolbarItem>
            </>}
        </>;

        return (
            <Page>
                <PageSection variant={PageSectionVariants.light} type='nav'>
                    <ServiceTabs activeTab={activeTab}
                                 tabErrors={this.state.tabErrors}
                                 onChange={activeTab => {
                                     cockpit.location.go([], Object.assign(cockpit.location.options, { type: activeTab }));
                                 }} />
                </PageSection>
                <PageSection>
                    <Card isCompact>
                        <DataToolbar
                            id="services-page">
                            <DataToolbarContent>{toolbarItems}</DataToolbarContent>
                        </DataToolbar>
                        <ServicesList key={cockpit.format("$0-list", activeTab)}
                            isTimer={activeTab == 'timer'}
                            units={units} />
                        {units.length == 0 &&
                            <Bullseye>
                                <EmptyStatePanel icon={SearchIcon}
                                    paragraph={_("No results match the filter criteria. Clear all filters to show results.")}
                                    action={<Button id="clear-all-filters" onClick={this.onClearAllFilters} isInline variant='link'>{_("Clear all filters")}</Button>}
                                    title={_("No matching results")} />
                            </Bullseye>}
                    </Card>
                </PageSection>
            </Page>
        );
    }
}

function init() {
    ReactDOM.render(
        <ServicesPage />,
        document.getElementById('services')
    );
}

document.addEventListener("DOMContentLoaded", init);
