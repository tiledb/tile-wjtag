#!/bin/bash
# Exit immediately if a command exits with a non-zero status
# set -e


# Install Python 3 and venv if not installed
if ! command -v python3 &> /dev/null; then
    # Update package lists
    sudo apt update
    echo "Python 3 is not installed. Installing..."
    sudo apt install -y python3 python3-venv python3-distutils python3-pip
fi

# Check Python version
python3 --version

# Create virtual environment if it doesn't exist
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
