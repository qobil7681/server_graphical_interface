#!/bin/sh
# Helper to add, modify, and remove a kernel command line option. This supports
# grub and zipl, i. e. x86, arm64, and s390x. Either grubby (Fedora, RHEL) or
# update-grub (Debian, Ubuntu) needs to be available.
#
# Copyright (C) 2019 Red Hat, Inc
set -eu

error() {
    echo "$1" >&2
    exit 1
}

grub() {
    key="${2%=*}"  # split off optional =value

    # For the non-BLS case, or if someone overrides those with grub2-mkconfig
    # or update-grub, change it in /etc/default/grub
    if [ -e /etc/default/grub ]; then
        if [ "$1" = set ]; then
            # replace existing argument, otherwise append it
            sed -i.bak -r "/^[[:space:]]*GRUB_CMDLINE_LINUX\b/ { s/$key(=[^[:space:]\"]*)?/$2/g; t; s/\"$/ $2\"/ }" /etc/default/grub
        else
            sed -i.bak -r "/^[[:space:]]*GRUB_CMDLINE_LINUX\b/ s/$key(=[^[:space:]\"]*)?//g" /etc/default/grub
        fi
    fi

    # on Fedora and RHEL, use grubby; this covers grub and BLS; s390x's zipl also supports BLS there
    if type grubby >/dev/null 2>&1; then
        if [ "$1" = set ]; then
            grubby --args="$2" --update-kernel=ALL
            # HACK: grubby on RHEL 8.0 does not change default kernel args (https://bugzilla.redhat.com/show_bug.cgi?id=1690765)
            envopts=$(grub2-editenv - list | grep ^kernelopts) || envopts=""
            if [ -n "$envopts" ]; then
                newenvopts=$(echo "$envopts" | sed -r "s/$key(=[^[:space:]\"]*)?/$2/g; t; s/$/ $2/")
            fi
        else
            grubby --remove-args="$2" --update-kernel=ALL
            envopts=$(grub2-editenv - list | grep ^kernelopts) || envopts=""
            if [ -n "$envopts" ]; then
                newenvopts=$(echo "$envopts" | sed -r "s/$key(=[^[:space:]\"]*)?//g")
            fi
        fi

        if [ -n "$envopts" ] && [ "$newenvopts" != "$envopts" ]; then
            grub2-editenv - set "$newenvopts"
        fi

    # on Debian/Ubuntu, use update-grub, which reads from /etc/default/grub
    elif [ -e /etc/default/grub ] && type update-grub >/dev/null 2>&1; then
        update-grub
    else
        error "No supported grub update mechanism found (grubby or update-grub)"
    fi
}

update_zipl() {
    if type zipl >/dev/null 2>&1; then
        zipl
    fi
}

#
# main
#

if [ -z "${2:-}" -o -n "${3:-}" ] || [ "$1" != "set" -a "$1" != "remove" ]; then
    error "Usage: '$0 set <option>[=<value>]' or '$0 remove <option>'"
fi

grub "$1" "$2"
update_zipl
