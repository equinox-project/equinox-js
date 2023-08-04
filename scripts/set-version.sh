#!/bin/bash

version=$1
# For each directory under ./packages/
for dir in ./packages/*; do
  # Get the version from the package.json file
  # Set the version in the package.json file
  jq --arg version "$version" '.version = $version' "$dir/package.json" > "$dir/package.json.tmp" && mv "$dir/package.json.tmp" "$dir/package.json"
done
