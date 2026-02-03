#!/bin/bash

# Exit on any error
# set -e

# Check if python3 is installed
if ! command -v python3 &> /dev/null
then
    echo "python3 is not installed. Please install Python 3 first."
    exit 1
fi

# Check if pip is installed
if ! python3 -m pip --version &> /dev/null
then
    echo "pip is not installed. Installing pip..."
    curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
    python3 get-pip.py
    rm get-pip.py
fi

# Create virtual environment
if [ ! -d ".pyenv" ]; then
    python3 -m venv .pyenv
    echo "Virtual environment '.pyenv' created."
else
    echo "Virtual environment '.pyenv' already exists."
fi

# Activate virtual environment
# shellcheck disable=SC1091
source .pyenv/bin/activate

# Upgrade pip inside the venv
pip install --upgrade pip

# Install Flask
pip install flask

echo "Setup complete. To activate the environment, run:"
echo "source .pyenv/bin/activate"

# deactivate