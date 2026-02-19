#!/bin/bash

# Monitor the systemd journal in real-time for GNOME Shell:
#  - The -o cat option outputs the log messages without any additional metadata, making it easier to read and parse.
#  - The -f option allows you to follow the log output in real-time, similar to tail -f.
journalctl /usr/bin/gnome-shell -f -o cat