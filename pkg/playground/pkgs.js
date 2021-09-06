import cockpit from "cockpit";

import '../lib/patternfly/patternfly-cockpit.scss';

document.addEventListener("DOMContentLoaded", () => {
    const proxy = cockpit.dbus(null, { bus: "internal" }).proxy("cockpit.Packages", "/packages");

    let manifests;

    function update(str) {
        var new_m = JSON.parse(str);
        var p;

        if (manifests) {
            for (p in new_m) {
                if (!manifests[p])
                    console.log("ADD", p);
                else if (manifests[p].checksum != new_m[p].checksum)
                    console.log("CHG", p);
            }
            for (p in manifests) {
                if (!new_m[p])
                    console.log("REM", p);
            }
        }

        manifests = new_m;
    }

    const debug_manifest_changes = false;

    proxy.wait(function () {
        document.body.removeAttribute("hidden");
        if (debug_manifest_changes) {
            update(proxy.Manifests);
            proxy.addEventListener("changed", () => update(proxy.Manifests));
        }
        document.getElementById("reload").addEventListener("click", () => {
            proxy.Reload()
                    .catch(error => console.log("ERROR", error));
        });
    });
});
