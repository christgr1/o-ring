#!/bin/bash

# Compile gschemas in the current directory
glib-compile-schemas ../o-ring@christgr1.github.io/schemas/

# Check if compilation was successful
if [ $? -eq 0 ]; then
    echo "Schemas compiled successfully"
else
    echo "Failed to compile schemas" >&2
    exit 1
fi