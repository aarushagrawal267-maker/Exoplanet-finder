"""``python -m exofinder`` runs the command-line interface (same as ``exofinder`` / ``python -m exofinder.cli``)."""

import sys

from exofinder.cli import main

if __name__ == "__main__":
    sys.exit(main())
