import cockpit from "cockpit";

import React from "react";
import ReactDOM from "react-dom";

import { Terminal } from "cockpit-components-terminal.jsx";

const _ = cockpit.gettext;

(function() {
    cockpit.translate();

    /*
     * A terminal component for the cockpit user.
     *
     * Uses the Terminal component from base1 internally, but adds a header
     * with title and Reset button.
     *
     * Spawns the user's shell in the user's home directory.
     */
    class UserTerminal extends React.Component {
        createChannel(user) {
            return cockpit.channel({
                "payload": "stream",
                "spawn": [user.shell || "/bin/bash", "-i"],
                "environ": [
                    "TERM=xterm-256color",
                    "PATH=/sbin:/bin:/usr/sbin:/usr/bin"
                ],
                "directory": user.home || "/",
                "pty": true
            });
        }

        constructor(props) {
            super(props);
            this.state = {
                title: 'Terminal'
            };
            this.onTitleChanged = this.onTitleChanged.bind(this);
            this.onResetClick = this.onResetClick.bind(this);
        }

        componentWillMount() {
            cockpit.user().done(function (user) {
                this.setState({ user: user, channel: this.createChannel(user) });
            }.bind(this));
        }

        onTitleChanged(title) {
            this.setState({ title: title });
        }

        onResetClick(event) {
            if (event.button !== 0)
                return;

            if (this.state.channel)
                this.state.channel.close();

            if (this.state.user)
                this.setState({ channel: this.createChannel(this.state.user) });

            // don't focus the button, but keep it on the terminal
            this.refs.resetButton.blur();
            this.refs.terminal.focus();
        }

        render() {
            var terminal;
            if (this.state.channel)
                terminal = (<Terminal ref="terminal"
                     channel={this.state.channel}
                     onTitleChanged={this.onTitleChanged} />);
            else
                terminal = <span>Loading...</span>;

            return (
                <div className="console-ct-container">
                    <div className="panel-heading">
                        <tt className="terminal-title">{this.state.title}</tt>
                        <button ref="resetButton"
                             className="btn btn-default pull-right"
                             onClick={this.onResetClick}>{_("Reset")}</button>
                    </div>
                    <div className="panel-body">
                        {terminal}
                    </div>
                </div>
            );
        }
    }
    UserTerminal.displayName = "UserTerminal";

    ReactDOM.render(<UserTerminal />, document.getElementById('terminal'));

    /* And show the body */
    document.body.removeAttribute("hidden");
}());
