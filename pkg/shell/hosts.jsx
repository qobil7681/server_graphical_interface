import cockpit from "cockpit";

import React from 'react';
import ReactDOM from "react-dom";
import PropTypes from 'prop-types';
import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import {
    CaretDownIcon,
    CaretUpIcon,
    EditIcon,
    ExclamationCircleIcon,
    ExternalLinkAltIcon,
    MinusIcon,
} from '@patternfly/react-icons';
import { Label } from "@patternfly/react-core/dist/esm/components/Label";
import { PageSidebar } from "@patternfly/react-core/dist/esm/components/Page";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip";

import 'polyfills';
import { CockpitNav, CockpitNavItem } from "./nav.jsx";
import { HostModal } from "./hosts_dialog.jsx";
import { useLoggedInUser } from "hooks";

const _ = cockpit.gettext;
const hosts_sel = document.getElementById("nav-hosts");

class HostsSelector extends React.Component {
    constructor() {
        super();
        this.el = document.createElement("div");
        this.el.className = "view-hosts";
    }

    componentDidMount() {
        hosts_sel.appendChild(this.el);
    }

    componentWillUnmount() {
        hosts_sel.removeChild(this.el);
    }

    render() {
        const { children } = this.props;
        return ReactDOM.createPortal(children, this.el);
    }
}

function HostLine({ host, user }) {
    return (
        <>
            <span id="current-username" className="username">{user}</span>
            {user && <span className="at">@</span>}
            <span className="hostname">{host}</span>
        </>
    );
}

// top left navigation element when host switching is disabled
export const CockpitCurrentHost = ({ machine }) => {
    const user_info = useLoggedInUser();

    return (
        <div className="ct-switcher ct-switcher-localonly pf-m-dark">
            <HostLine user={machine.user || user_info?.name || ""} host={machine.label || ""} />
        </div>
    );
};

// full host switcher
export class CockpitHosts extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            opened: false,
            editing: false,
            current_user: "",
            current_key: props.machine.key,
            show_modal: false,
            edit_machine: null,
        };

        this.toggleMenu = this.toggleMenu.bind(this);
        this.filterHosts = this.filterHosts.bind(this);
        this.onAddNewHost = this.onAddNewHost.bind(this);
        this.onEditHosts = this.onEditHosts.bind(this);
        this.onHostEdit = this.onHostEdit.bind(this);
        this.onRemove = this.onRemove.bind(this);
    }

    componentDidMount() {
        cockpit.user().then(user => {
            this.setState({ current_user: user.name || "" });
        }).catch(exc => console.log(exc));
    }

    static getDerivedStateFromProps(nextProps, prevState) {
        if (nextProps.machine.key !== prevState.current_key) {
            document.getElementById(nextProps.selector).classList.toggle("interact", false);
            return {
                current_key: nextProps.machine.key,
                opened: false,
                editing: false,
            };
        }
        return null;
    }

    toggleMenu() {
        document.getElementById(this.props.selector).classList.toggle("interact", !this.state.opened);

        this.setState(s => {
            return (
                {
                    opened: !s.opened,
                    editing: false,
                }
            );
        });
    }

    onAddNewHost() {
        this.setState({ show_modal: true });
    }

    onHostEdit(event, machine) {
        this.setState({ show_modal: true, edit_machine: machine });
    }

    onEditHosts() {
        this.setState(s => { return { editing: !s.editing } });
    }

    onRemove(event, machine) {
        event.preventDefault();

        if (this.props.machine === machine) {
            // Removing machine underneath ourself - jump to localhost
            const addr = this.props.hostAddr({ host: "localhost" }, true);
            this.props.jump(addr);
        }

        if (this.props.machines.list.length <= 2)
            this.setState({ editing: false });
        this.props.machines.change(machine.key, { visible: false });
    }

    filterHosts(host, term) {
        if (!term)
            return host;
        const new_host = Object.assign({}, host);
        term = term.toLowerCase();

        if (host.label.toLowerCase().indexOf(term) > -1)
            new_host.keyword = host.label.toLowerCase();

        const user = host.user || this.state.current_user;
        if (user.toLowerCase().indexOf(term) > -1)
            new_host.keyword = user.toLowerCase() + " @";

        if (new_host.keyword)
            return new_host;
        return null;
    }

    // HACK: using HTML rather than Select PF4 component as:
    // 1. It does not change the arrow when opened/closed
    // 2. It closes the dropdown even when trying to search... and cannot tell it not to
    render() {
        const hostAddr = this.props.hostAddr;
        const editing = this.state.editing;
        const groups = [{
            name: _("Hosts"),
            items: this.props.machines.list,
        }];
        const render = (m, term) => <CockpitNavItem
                term={term}
                keyword={m.keyword}
                to={hostAddr({ host: m.address }, true)}
                active={m === this.props.machine}
                key={m.key}
                name={m.label}
                header={(m.user ? m.user : this.state.current_user) + " @"}
                status={m.state === "failed" ? { type: "error", title: _("Connection error") } : null}
                className={m.state}
                jump={this.props.jump}
                actions={<>
                    <Tooltip content={_("Edit")} position="right">
                        <Button isDisabled={m.address === "localhost"} className="nav-action" hidden={!editing} onClick={e => this.onHostEdit(e, m)} key={m.label + "edit"} variant="secondary"><EditIcon /></Button>
                    </Tooltip>
                    <Tooltip content={_("Remove")} position="right">
                        <Button isDisabled={m.address === "localhost"} onClick={e => this.onRemove(e, m)} className="nav-action" hidden={!editing} key={m.label + "remove"} variant="danger"><MinusIcon /></Button>
                    </Tooltip>
                </>}
        />;
        const label = this.props.machine.label || "";
        const user = this.props.machine.user || this.state.current_user;

        let add_host_action;

        if (this.props.enable_add_host) {
            add_host_action = <Button variant="secondary" onClick={this.onAddNewHost}>{_("Add new host")}</Button>;
        } else {
            const footer = <a href="https://cockpit-project.org/blog/cockpit-322.html" target="_blank" rel="noreferrer">
                <ExternalLinkAltIcon /> {_("Read more...")}
            </a>;
            add_host_action = (
                <Popover id="disabled-add-host-help"
                         headerContent={_("Host switching is not supported")}
                         bodyContent={_("Connecting to remote hosts inside of a web console session is deprecated and will be removed in the future. You can still connect to your existing hosts for now.")}
                         footerContent={footer}>
                    <Label className="deprecated-add-host" color="blue" icon={<ExclamationCircleIcon />}>{_("Deprecated")}</Label>
                </Popover>);
        }

        return (
            <>
                <div className="ct-switcher">
                    <div className="pf-v5-c-select pf-m-dark">
                        <button onClick={this.toggleMenu} id="host-toggle" aria-labelledby="host-toggle" aria-expanded={(this.state.opened ? "true" : "false")} aria-haspopup="listbox" type="button" className="ct-nav-toggle pf-v5-c-select__toggle pf-m-plain">
                            <span className="pf-v5-c-select__toggle-wrapper desktop_v">
                                <span className="pf-v5-c-select__toggle-text">
                                    <HostLine user={user} host={label} />
                                </span>
                            </span>
                            <CaretUpIcon
                                className={`pf-v5-c-select__toggle-arrow mobile_v pf-v5-c-icon pf-m-lg ${this.state.opened ? 'clicked' : ''}`}
                                aria-hidden="true"
                            />
                            <span className="pf-v5-c-select__toggle-wrapper mobile_v">
                                {_("Host")}
                            </span>
                            <CaretDownIcon
                                className={`pf-v5-c-select__toggle-arrow desktop_v pf-v5-c-icon ${this.state.opened ? 'clicked' : ''}`}
                                aria-hidden="true"
                            />

                        </button>
                    </div>

                    { this.state.opened &&
                    <HostsSelector>
                        <PageSidebar isSidebarOpen={this.props.opened} theme="dark" className={"sidebar-hosts" + (this.state.editing ? " edit-hosts" : "")}>
                            <CockpitNav
                                selector={this.props.selector}
                                groups={groups}
                                item_render={render}
                                sorting={(a, b) => true}
                                filtering={this.filterHosts}
                                current={label}
                                jump={() => console.error("internal error: jump not supported in hosts selector")}
                            />
                            <div className="nav-hosts-actions">
                                {this.props.machines.list.length > 1 && <Button variant="secondary" onClick={this.onEditHosts}>{this.state.editing ? _("Stop editing hosts") : _("Edit hosts")}</Button>}
                                {add_host_action}
                            </div>
                        </PageSidebar>
                    </HostsSelector>
                    }
                </div>
                {this.state.show_modal &&
                    <HostModal machines_ins={this.props.machines}
                               onClose={() => this.setState({ show_modal: false, edit_machine: null })}
                               address={this.state.edit_machine ? this.state.edit_machine.address : null}
                               caller_callback={this.state.edit_machine
                                   ? (new_connection_string) => {
                                       const parts = this.props.machines.split_connection_string(new_connection_string);
                                       if (this.state.edit_machine == this.props.machine && parts.address != this.state.edit_machine.address) {
                                           const addr = this.props.hostAddr({ host: parts.address }, true);
                                           this.props.jump(addr);
                                       }
                                       return Promise.resolve();
                                   }
                                   : null } />
                }
            </>
        );
    }
}

CockpitHosts.propTypes = {
    machine: PropTypes.object.isRequired,
    machines: PropTypes.object.isRequired,
    selector: PropTypes.string.isRequired,
    hostAddr: PropTypes.func.isRequired,
    jump: PropTypes.func.isRequired,
    enable_add_host: PropTypes.bool.isRequired,
};
