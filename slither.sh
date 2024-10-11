#!/bin/sh

solc-select install 0.8.26
solc-select use 0.8.26

slither contracts/*.sol