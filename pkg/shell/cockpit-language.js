/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

var shell = shell || { };
(function($, cockpit, shell) {

PageDisplayLanguageDialog.prototype = {
    _init: function() {
        this.id = "display-language-dialog";
    },

    enter: function() {
        // Note: we may not have D-Bus connection available (could be invoked from
        // the login page) so we need to use the cockpitdyn.js mechanism to obtain
        // info to display

        var list = $("#display-language-list");
        var code;
        list.empty();
        /* TODO: This needs to be reworked */
        var languages = { };
        for (code in languages) {
            var info = languages[code];
            var name = info.name;
            var display_name = shell.i18n(name, "display-language");
            if (code == shell.language_code)
                list.append("<option selected=\"true\" value=\"" + code + "\">" + display_name + "</option>");
            else
                list.append("<option value=\"" + code + "\">" + display_name + "</option>");
        }

        $("#display-language-select-button").on("click", function(event) {
            var code_to_select = list.val();

            // Load via AJAX
            if (code_to_select) {
                var jqxhr = $.getJSON("lang/" + code_to_select + ".json");
                jqxhr.error(function() {
                    shell.show_error_dialog("Error loading language \"" + code_to_select + "\"");
                });
                jqxhr.success(function(data) {
                    shell.language_code = code_to_select;
                    shell.language_po = data[code_to_select];
                    $('#display-language-dialog').modal('hide');
                    // Cool, that worked, update setting
                    localStorage.setItem("lang-code", code_to_select);
                    shell.localize_pages();
                });
            } else {
                // English
                shell.language_code = "";
                shell.language_po = null;
                // update setting
                localStorage.removeItem("lang-code");
                $('#display-language-dialog').modal('hide');
                shell.localize_pages();
            }

            return false;
        });
    },

    show: function() {
        $("#display-language-list").focus();
    },

    leave: function() {
        $("#display-language-select-button").off("click");
    }
};

function PageDisplayLanguageDialog() {
    this._init();
}

shell.dialogs.push(new PageDisplayLanguageDialog());

})(jQuery, cockpit, shell);
