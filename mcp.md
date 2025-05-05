<project>
  <source>/Users/johnlindquist/dev/cursor-db-mcp</source>
  <timestamp>20250424-092302</timestamp>
  <command>ffg -y</command>
</project>
<summary>
  Analyzing: /Users/johnlindquist/dev/cursor-db-mcp
  Max file size: 10240KB
  Skipping build artifacts and generated files
Files analyzed: 7
</summary>
<directoryTree>
└── cursor-db-mcp/
  ├── .gitignore
  ├── cursor-db-mcp-server.py
  ├── img/
  │ ├── claude-logo.png (excluded - binary)
  │ ├── cursor-db-keys.png (excluded - binary)
  │ ├── cursor-db-mcp-claude.gif (excluded - binary)
  │ ├── cursor-db-mcp-in-cursor.gif (excluded - binary)
  │ ├── cursor-db-mcp.png (excluded - binary)
  │ ├── cursor-db-structure.png (excluded - binary)
  │ ├── cursor-journal-logo_thumbnail.jpg (excluded - binary)
  │ └── mcp-cursor-db-search.png (excluded - binary)
  ├── install.py
  ├── LICENSE
  ├── README.md
  ├── requirements.txt
  └── test_mcp_server.py

</directoryTree>
<files>
  <file path=".gitignore">
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
.venv/
venv/
ENV/
env/
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# Cursor specific
tmp/

# Logs
*.log

# OS specific
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# IDE specific
.idea/
.vscode/
*.swp
*.swo 

# Project test results
test-results.txt

.cursor
mcp-server.log

  </file>
  <file path="cursor-db-mcp-server.py">
import os
import json
import sqlite3
import platform
import re
from pathlib import Path
import argparse
import logging
from typing import Dict, List, Optional, Any, Union, AsyncIterator
from contextlib import asynccontextmanager
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mcp-server.log")),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('cursor-mcp')

# Import MCP libraries
try:
    from mcp.server.fastmcp import FastMCP, Context
except ImportError as e:
    logger.error(f"Failed to import MCP libraries: {str(e)}. Make sure they are installed.")
    sys.exit(1)

# Global DB manager instance
db_manager = None

class CursorDBManager:
    def __init__(self, cursor_path=None, project_dirs=None):
        """
        Initialize the CursorDBManager with a Cursor main directory and/or list of project directories.
        
        Args:
            cursor_path (str): Path to main Cursor directory (e.g. ~/Library/Application Support/Cursor/User/)
            project_dirs (list): List of paths to Cursor project directories containing state.vscdb files
        """
        if cursor_path:
            self.cursor_path = Path(cursor_path).expanduser().resolve()
        else:
            # Try to get the default cursor path
            self.cursor_path = self.get_default_cursor_path()
            
        self.project_dirs = project_dirs or []
        self.db_paths = {}
        self.projects_info = {}
        self.global_db_path = None
        self.refresh_db_paths()
    
    def get_default_cursor_path(self):
        """Return the default Cursor path based on the operating system"""
        system = platform.system()
        home = Path.home()
        
        default_path = None
        if system == "Darwin":  # macOS
            default_path = home / "Library/Application Support/Cursor/User"
        elif system == "Windows":
            default_path = home / "AppData/Roaming/Cursor/User"
        elif system == "Linux":
            default_path = home / ".config/Cursor/User"
        else:
            logger.warning(f"Unknown operating system: {system}. Cannot determine default Cursor path.")
            return None
        
        logger.info(f"Detected default Cursor path for {system}: {default_path}")
        return default_path
    
    def detect_cursor_projects(self):
        """Detect Cursor projects by scanning the workspaceStorage directory"""
        if not self.cursor_path:
            logger.error("No Cursor path available")
            return []
            
        # Check if the path exists
        if not self.cursor_path.exists():
            logger.error(f"Cursor path does not exist: {self.cursor_path}")
            return []
                
        workspace_storage = self.cursor_path / "workspaceStorage"
        if not workspace_storage.exists():
            logger.warning(f"Workspace storage directory not found: {workspace_storage}")
            return []
            
        logger.info(f"Found workspace storage directory: {workspace_storage}")
        
        projects = []
        
        # Scan all subdirectories in workspaceStorage
        for workspace_dir in workspace_storage.iterdir():
            if not workspace_dir.is_dir():
                continue
                
            workspace_json = workspace_dir / "workspace.json"
            state_db = workspace_dir / "state.vscdb"
            
            if workspace_json.exists() and state_db.exists():
                try:
                    with open(workspace_json, 'r') as f:
                        workspace_data = json.load(f)
                        
                    folder_uri = workspace_data.get("folder")
                    if folder_uri:
                        # Extract the project name from the URI
                        # For "file:///Users/johndamask/code/cursor-chat-browser", get "cursor-chat-browser"
                        project_name = folder_uri.rstrip('/').split('/')[-1]
                        
                        projects.append({
                            "name": project_name,
                            "db_path": str(state_db),
                            "workspace_dir": str(workspace_dir),
                            "folder_uri": folder_uri
                        })
                        logger.info(f"Found project: {project_name} at {state_db}")
                except Exception as e:
                    logger.error(f"Error processing workspace: {workspace_dir}: {e}")
        
        return projects
        
    def refresh_db_paths(self):
        """Scan project directories and identify all state.vscdb files"""
        self.db_paths = {}
        self.projects_info = {}
        
        # First, detect projects from the Cursor directory
        if self.cursor_path:
            cursor_projects = self.detect_cursor_projects()
            for project in cursor_projects:
                project_name = project["name"]
                self.db_paths[project_name] = project["db_path"]
                self.projects_info[project_name] = project
            
            # Set the global storage database path
            global_storage_path = self.cursor_path / "globalStorage" / "state.vscdb"
            if global_storage_path.exists():
                self.global_db_path = str(global_storage_path)
                logger.info(f"Found global storage database at {self.global_db_path}")
            else:
                logger.warning(f"Global storage database not found at {global_storage_path}")
        
        # Then add explicitly specified project directories
        for project_dir in self.project_dirs:
            project_path = Path(project_dir).expanduser().resolve()
            db_path = project_path / "state.vscdb"
            
            if db_path.exists():
                project_name = project_path.name
                self.db_paths[project_name] = str(db_path)
                self.projects_info[project_name] = {
                    "name": project_name,
                    "db_path": str(db_path),
                    "workspace_dir": None,
                    "folder_uri": None
                }
                logger.info(f"Found database: {project_name} at {db_path}")
            else:
                logger.warning(f"No state.vscdb found in {project_path}")
        
    # def add_project_dir(self, project_dir):
    #     """Add a new project directory to the manager"""
    #     project_path = Path(project_dir).expanduser().resolve()
    #     if project_path not in self.project_dirs:
    #         self.project_dirs.append(project_path)
    #         self.refresh_db_paths()
    #     return len(self.db_paths)
    
    def list_projects(self, detailed=False):
        """
        Return list of available projects
        
        Args:
            detailed (bool): Whether to return detailed project information
            
        Returns:
            dict: Project information (either just DB paths or full details)
        """
        if detailed:
            return self.projects_info
        return self.db_paths
    
    def execute_query(self, project_name, table_name, query_type, key=None, limit=100):
        """
        Execute a query against a specific project's database
        
        Args:
            project_name (str): Name of the project (key in db_paths)
            table_name (str): Either 'ItemTable' or 'cursorDiskKV'
            query_type (str): Type of query ('get_all', 'get_by_key', 'search_keys')
            key (str, optional): Key to search for when using 'get_by_key' or 'search_keys'
            limit (int): Maximum number of results to return
            
        Returns:
            list: Query results
        """
        if project_name not in self.db_paths:
            raise ValueError(f"Project '{project_name}' not found")
            
        if table_name not in ["ItemTable", "cursorDiskKV"]:
            raise ValueError("Table name must be either 'ItemTable' or 'cursorDiskKV'")
        
        db_path = self.db_paths[project_name]
        
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            if query_type == "get_all":
                cursor.execute(f"SELECT key, value FROM {table_name} LIMIT ?", (limit,))
            elif query_type == "get_by_key" and key:
                cursor.execute(f"SELECT key, value FROM {table_name} WHERE key = ?", (key,))
            elif query_type == "search_keys" and key:
                search_term = f"%{key}%"
                cursor.execute(f"SELECT key, value FROM {table_name} WHERE key LIKE ? LIMIT ?", 
                              (search_term, limit))
            else:
                raise ValueError("Invalid query type or missing key parameter")
                
            results = []
            for row in cursor.fetchall():
                key, value = row
                try:
                    # Try to parse JSON value
                    parsed_value = json.loads(value)
                    results.append({"key": key, "value": parsed_value})
                except json.JSONDecodeError:
                    # If not valid JSON, return as string
                    results.append({"key": key, "value": value})
            
            conn.close()
            return results
            
        except sqlite3.Error as e:
            logger.error(f"SQLite error: {e}")
            raise
    
    def get_chat_data(self, project_name):
        """
        Retrieve AI chat data from a project
        
        Args:
            project_name (str): Name of the project
            
        Returns:
            dict: Chat data from the project
        """
        if project_name not in self.db_paths:
            raise ValueError(f"Project '{project_name}' not found")
        
        try:
            results = self.execute_query(
                project_name, 
                "ItemTable", 
                "get_by_key", 
                "workbench.panel.aichat.view.aichat.chatdata"
            )
            
            if results and len(results) > 0:
                return results[0]["value"]
            else:
                return {"error": "No chat data found for this project"}
                
        except Exception as e:
            logger.error(f"Error retrieving chat data: {e}")
            raise
    
    def get_composer_ids(self, project_name):
        """
        Retrieve composer IDs from a project
        
        Args:
            project_name (str): Name of the project
            
        Returns:
            list: List of composer IDs
        """
        if project_name not in self.db_paths:
            raise ValueError(f"Project '{project_name}' not found")
        
        try:
            results = self.execute_query(
                project_name, 
                "ItemTable", 
                "get_by_key", 
                "composer.composerData"
            )
            
            if results and len(results) > 0:
                composer_data = results[0]["value"]
                # Extract composer IDs from the data
                composer_ids = []
                if "allComposers" in composer_data:
                    for composer in composer_data["allComposers"]:
                        if "composerId" in composer:
                            composer_ids.append(composer["composerId"])
                return {
                    "composer_ids": composer_ids,
                    "full_data": composer_data
                }
            else:
                return {"error": "No composer data found for this project"}
                
        except Exception as e:
            logger.error(f"Error retrieving composer IDs: {e}")
            raise
    
    def get_composer_data(self, composer_id):
        """
        Retrieve composer data from global storage
        
        Args:
            composer_id (str): Composer ID
            
        Returns:
            dict: Composer data
        """
        if not self.global_db_path:
            raise ValueError("Global storage database not found")
        
        try:
            conn = sqlite3.connect(self.global_db_path)
            cursor = conn.cursor()
            
            key = f"composerData:{composer_id}"
            cursor.execute("SELECT value FROM cursorDiskKV WHERE key = ?", (key,))
            
            row = cursor.fetchone()
            conn.close()
            
            if row:
                try:
                    return {"composer_id": composer_id, "data": json.loads(row[0])}
                except json.JSONDecodeError:
                    return {"composer_id": composer_id, "data": row[0]}
            else:
                return {"error": f"No data found for composer ID: {composer_id}"}
                
        except sqlite3.Error as e:
            logger.error(f"SQLite error: {e}")
            raise

# Create an MCP server with lifespan support
@asynccontextmanager
async def app_lifespan(app: FastMCP) -> AsyncIterator[Dict[str, Any]]:
    """Manage application lifecycle with context"""
    try:
        # Initialize the DB manager on startup
        global db_manager
        db_manager = CursorDBManager()
        
        # Parse command line arguments
        parser = argparse.ArgumentParser(description='Cursor IDE SQLite Database MCP Server')
        parser.add_argument('--cursor-path', help='Path to Cursor User directory (e.g. ~/Library/Application Support/Cursor/User/)')
        parser.add_argument('--project-dirs', nargs='+', help='List of additional Cursor project directories to scan')
        
        # Parse known args only, to avoid conflicts with MCP's own args
        args, _ = parser.parse_known_args()
        
        # Configure the DB manager with the Cursor path
        if args.cursor_path:
            db_manager.cursor_path = Path(args.cursor_path).expanduser().resolve()
        
        # Add explicitly specified project directories
        if args.project_dirs:
            for project_dir in args.project_dirs:
                db_manager.add_project_dir(project_dir)
        
        # Log detected Cursor path
        if db_manager.cursor_path:
            logger.info(f"Using Cursor path: {db_manager.cursor_path}")
        else:
            logger.warning("No Cursor path specified or detected")
        
        logger.info(f"Available projects: {list(db_manager.list_projects().keys())}")
        
        # Yield empty context - we're using global db_manager instead
        yield {}
    finally:
        # Cleanup on shutdown (if needed)
        logger.info("Shutting down Cursor DB MCP server")

# Create the MCP server with lifespan
mcp = FastMCP("Cursor DB Manager", lifespan=app_lifespan)

# MCP Resources
@mcp.resource("cursor://projects")
def list_all_projects() -> Dict[str, str]:
    """List all available Cursor projects and their database paths"""
    global db_manager
    return db_manager.list_projects(detailed=False)

@mcp.resource("cursor://projects/detailed")
def list_detailed_projects() -> Dict[str, Dict[str, Any]]:
    """List all available Cursor projects with detailed information"""
    global db_manager
    return db_manager.list_projects(detailed=True)

@mcp.resource("cursor://projects/{project_name}/chat")
def get_project_chat_data(project_name: str) -> Dict[str, Any]:
    """Retrieve AI chat data from a specific Cursor project"""
    global db_manager
    try:
        return db_manager.get_chat_data(project_name)
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"Error retrieving chat data: {str(e)}"}

@mcp.resource("cursor://projects/{project_name}/composers")
def get_project_composer_ids(project_name: str) -> Dict[str, Any]:
    """Retrieve composer IDs from a specific Cursor project"""
    global db_manager
    try:
        return db_manager.get_composer_ids(project_name)
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"Error retrieving composer data: {str(e)}"}

@mcp.resource("cursor://composers/{composer_id}")
def get_composer_data_resource(composer_id: str) -> Dict[str, Any]:
    """Retrieve composer data from global storage"""
    global db_manager
    try:
        return db_manager.get_composer_data(composer_id)
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"Error retrieving composer data: {str(e)}"}

# MCP Tools
@mcp.tool()
def query_table(project_name: str, table_name: str, query_type: str, key: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    """
    Query a specific table in a project's database
    
    Args:
        project_name: Name of the project
        table_name: Either 'ItemTable' or 'cursorDiskKV'
        query_type: Type of query ('get_all', 'get_by_key', 'search_keys')
        key: Key to search for when using 'get_by_key' or 'search_keys'
        limit: Maximum number of results to return
    
    Returns:
        List of query results
    """
    global db_manager
    try:
        return db_manager.execute_query(project_name, table_name, query_type, key, limit)
    except ValueError as e:
        return [{"error": str(e)}]
    except sqlite3.Error as e:
        return [{"error": f"Database error: {str(e)}"}]

@mcp.tool()
def refresh_databases() -> Dict[str, Any]:
    """Refresh the list of database paths"""
    global db_manager
    db_manager.refresh_db_paths()
    return {
        "message": "Database paths refreshed",
        "projects": db_manager.list_projects()
    }

# @mcp.tool()
# def add_project_directory(project_dir: str) -> Dict[str, Any]:
#     """
#     Add a new project directory to the manager
    
#     Args:
#         project_dir: Path to the project directory
    
#     Returns:
#         Result of the operation
#     """
#     global db_manager
#     try:
#         count = db_manager.add_project_dir(project_dir)
#         return {
#             "message": f"Project directory added. Total projects: {count}",
#             "projects": db_manager.list_projects()
#         }
#     except Exception as e:
#         return {"error": f"Error adding project directory: {str(e)}"}

# MCP Prompts
@mcp.prompt()
def explore_cursor_projects() -> str:
    """Create a prompt to explore Cursor projects"""
    return """
    I can help you explore your Cursor projects and their data. 
    
    Here are some things I can do:
    1. List all your Cursor projects
    2. Show AI chat history from a project
    3. Find composer data
    4. Query specific tables in the Cursor database
    
    What would you like to explore?
    """

@mcp.prompt()
def analyze_chat_data(project_name: str) -> str:
    """Create a prompt to analyze chat data from a specific project"""
    return f"""
    I'll analyze the AI chat data from your '{project_name}' project.
    
    I can help you understand:
    - The conversation history
    - Code snippets shared in the chat
    - Common themes or questions
    
    Would you like me to focus on any specific aspect of the chat data?
    """

  </file>
  <file path="install.py">
#!/usr/bin/env python3
"""
Installation script for the Cursor DB MCP server.
This script creates a virtual environment and installs all necessary dependencies,
including the MCP CLI, into that isolated environment.
"""

import subprocess
import sys
import os
import platform
import shutil
import site

def create_and_setup_venv():
    """Create a virtual environment and return the path to its Python executable."""
    venv_dir = ".venv"
    
    # Check if venv already exists
    if os.path.exists(venv_dir):
        print(f"Virtual environment already exists at ./{venv_dir}")
        should_recreate = input("Do you want to recreate it? (y/n): ").lower().strip()
        if should_recreate == 'y':
            print(f"Removing existing virtual environment at ./{venv_dir}...")
            shutil.rmtree(venv_dir)
        else:
            print(f"Using existing virtual environment at ./{venv_dir}")
    
    # Create venv if it doesn't exist or was removed
    if not os.path.exists(venv_dir):
        print(f"\nCreating virtual environment in ./{venv_dir}...")
        try:
            # Use the built-in venv module
            subprocess.check_call([sys.executable, "-m", "venv", venv_dir])
        except subprocess.CalledProcessError:
            print("Failed to create virtual environment using venv module.")
            print("Please make sure you have the venv module installed.")
            sys.exit(1)
    
    # Determine the path to the Python executable in the virtual environment
    if platform.system() == "Windows":
        python_path = os.path.join(venv_dir, "Scripts", "python.exe")
        pip_path = os.path.join(venv_dir, "Scripts", "pip.exe")
    else:
        python_path = os.path.join(venv_dir, "bin", "python")
        pip_path = os.path.join(venv_dir, "bin", "pip")
    
    # Verify the virtual environment was created successfully
    if not os.path.exists(python_path):
        print(f"Error: Could not find Python executable at {python_path}")
        print("Virtual environment creation may have failed.")
        sys.exit(1)
        
    return python_path

def main():
    print("Setting up Cursor DB MCP server...")
    
    # Create virtual environment and get the Python path
    python_path = create_and_setup_venv()
    
    # Upgrade pip in the virtual environment
    print("\nUpgrading pip in the virtual environment...")
    subprocess.check_call([python_path, "-m", "pip", "install", "--upgrade", "pip"])
    
    # Install basic dependencies
    print("\nInstalling basic dependencies...")
    subprocess.check_call([python_path, "-m", "pip", "install", "-r", "requirements.txt"])
    
    # # Install MCP CLI dependencies
    # print("\nInstalling MCP CLI dependencies...")
    # try:
    #     # Try to install with quotes to handle square brackets
    #     subprocess.check_call([python_path, "-m", "pip", "install", "mcp[cli]"])
    # except subprocess.CalledProcessError:
    #     # If that fails, install the dependencies directly
    #     print("Direct installation of mcp[cli] failed. Installing CLI dependencies individually...")
    #     subprocess.check_call([python_path, "-m", "pip", "install", "mcp", "typer>=0.9.0", "rich>=13.0.0"])
    
    print("\nInstallation completed successfully!")
    
    # # Print activation instructions
    # venv_dir = "venv"
    # print(f"\nTo use the Cursor DB MCP server, you need to activate the virtual environment:")
    # if platform.system() == "Windows":
    #     print(f"    {venv_dir}\\Scripts\\activate")
    # else:
    #     print(f"    source {venv_dir}/bin/activate")
    
    # print("\nAfter activation, you can test the MCP server with:")
    # print("    python test_mcp_server.py")


if __name__ == "__main__":
    main() 

  </file>
  <file path="LICENSE">
# Released under MIT License

Copyright (c) 2025 John Damask.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

  </file>
  <file path="README.md">
# Cursor DB MCP Server

A Model Context Protocol (MCP) server for accessing Cursor IDE's SQLite databases. This server allows AI assistants to explore and interact with Cursor's project data, chat history, and composer information.

<!-- __Claude__
![In Claude GIF](./img/cursor-db-mcp-claude.gif) -->

__Cursor__
![In Cursor GIF](./img/cursor-db-mcp-in-cursor.gif)


## Prerequisites

Cursor IDE
<!-- Claude Desktop (if you want to use MCP in Claude) -->

## Installation

### Easy Installation

Use the provided installation script to install all dependencies:

```bash
python install.py
```

This script will install:
- Basic MCP server and dependencies

<!-- ### Manual Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/cursor-db-mcp.git
cd cursor-db-mcp
```

2. Install basic dependencies:
```bash
pip install -r requirements.txt
```

3. Install MCP CLI tools (optional, for testing):
```bash
pip install 'mcp[cli]'  # Note the quotes around mcp[cli]
```

If the above command fails, you can install the CLI dependencies directly:
```bash
pip install typer rich
``` -->

<!-- ## Usage

### Using with Claude Desktop

1. Install the MCP server in Claude Desktop:
```bash
mcp install cursor-db-mcp-server.py
```

2. In Claude Desktop, you can now access your Cursor data by asking questions like:
   - "Show me a list of my Cursor projects"
   - "What's in my chat history for project X?"
   - "Find composer data for composer ID Y"

   See detailed examples below

Note: If Claude shows an error connecting to this MCP it's likely because it can't find uv. To fix this, change the command value to include the fully qualified path to uv. For example:
```
    "Cursor DB Manager": {
      "command": "/Users/johndamask/.local/bin/uv",
      "args": [
        "run",
        "--with",
        "mcp[cli]",
        "mcp",
        "run",
        "/Users/johndamask/code/cursor-db-mcp/cursor-db-mcp-server.py"
      ]
    }
``` -->

## Using with Cursor IDE

1. Open Cursor and navigate to Settings->Cursor Settings->MCP. 
2. Click: Add new MCP server
3. Name: Cursor DB MCP; Type: Command
4. Command: \<fully qualified path to\>uv run --with mcp[cli] mcp run \<fully qualified path to\>/cursor-db-mcp-server.py 

![Cursor DB MCP](./img/cursor-db-mcp.png)

Now you can ask questions about the database or retrieve info about historical chats.

![DB structure](./img/cursor-db-structure.png)

![DB keys](./img/cursor-db-keys.png)

### Using with Claude Desktop 

[Installing MCP servers for Claude Desktop](https://modelcontextprotocol.io/quickstart/user)

Add this to your claude_desktop_config.json file
```
    "cursor-db-mcp": {
      "command": "<fully qualified path to >/uv",
      "args": [
        "run",
        "--with",
        "mcp[cli]",
        "mcp",
        "run",
        "<fully qualified path to >/cursor-db-mcp-server.py"
      ]
    }
```


![Cursor DB fuzzy search](./img/mcp-cursor-db-search.png)

## Available Resources

- `cursor://projects` - List all available Cursor projects
- `cursor://projects/detailed` - List projects with detailed information
- `cursor://projects/{project_name}/chat` - Get chat data for a specific project
- `cursor://projects/{project_name}/composers` - Get composer IDs for a specific project
- `cursor://composers/{composer_id}` - Get data for a specific composer

## Available Tools

- `query_table` - Query a specific table in a project's database
- `refresh_databases` - Refresh the list of database paths


<!-- # Example Usage with Claude

## Listing Projects

**User**: "Can you show me a list of my Cursor projects?"

**Claude**: 
```
I'll retrieve a list of your Cursor projects.

Here are the Cursor projects I found:
- project1 (path: /Users/username/Library/Application Support/Cursor/User/workspaceStorage/abc123/state.vscdb)
- project2 (path: /Users/username/Library/Application Support/Cursor/User/workspaceStorage/def456/state.vscdb)
- custom-project (path: /Users/username/code/custom-project/state.vscdb)
```

## Viewing Chat History

**User**: "Show me the chat history from my 'project1' project."

**Claude**:
```
I'll retrieve the chat history from your 'project1' project.

Here's the chat history I found:

Chat: "Understanding React Hooks"
- You: "Can you explain how useEffect works in React?"
- Claude: "The useEffect hook in React is used for handling side effects in functional components..."

Chat: "Debugging API Connection"
- You: "I'm getting a 401 error when connecting to the API. Here's my code..."
- Claude: "It looks like you're missing the authorization header in your request..."
```

## Querying Database Tables

**User**: "Can you search for keys related to 'settings' in the ItemTable of my 'project1' project?"

**Claude**:
```
I'll search for keys related to 'settings' in the ItemTable of your 'project1' project.

Here are the results:
1. Key: "workbench.settings.editor"
   Value: {"mode": "ui", "lastFocusedSettingId": "editor.fontSize"}

2. Key: "settings.language"
   Value: "en"

3. Key: "settings.theme"
   Value: "dark"
```

## Analyzing Chat Data

**User**: "Can you analyze the chat data from my 'project1' project and tell me what topics I've been discussing most frequently?"

**Claude**:
```
I'll analyze the chat data from your 'project1' project.

Based on your chat history, here are the most frequent topics you've been discussing:
1. React Hooks and Components (5 conversations)
2. API Integration (3 conversations)
3. CSS Styling (2 conversations)
4. Performance Optimization (2 conversations)
5. Debugging (1 conversation)

The most common questions were about state management in React and handling API responses.
``` 

# Architecture

The server uses the Model Context Protocol (MCP) to expose Cursor's SQLite databases to AI assistants. Key components include:

1. **Lifespan Context Management**: The server uses MCP's lifespan API to efficiently manage resources throughout the server's lifecycle.

2. **CursorDBManager**: Handles the detection and management of Cursor projects and their databases.

3. **Resources**: Expose data from Cursor databases as MCP resources.

4. **Tools**: Provide functionality to query databases and manage projects.

5. **Prompts**: Define reusable templates for AI interactions. -->

# How It Works

The server scans your Cursor installation directory to find project databases (state.vscdb files). It then exposes these databases through MCP resources and tools, allowing AI assistants to query and analyze the data.

# Notes
1. Cursor stores AI conversations in different places. Increasingly, chats are stored as "composerData" under globalStorage/state.vscdb. If you don't get results when asking about chats for recent projects, try asking for composers.
2. This was written on a Mac. YMMV with other OS

# Shameless Plug
<img src="./img/cursor-journal-logo_thumbnail.jpg" width="150" />

Like this? Try [Cursor Journal](https://medium.com/@jbdamask/building-cursor-journal-with-cursor-77445026a08c) to create DevLogs directly from Cursor chat history!

# License

MIT 

  </file>
  <file path="requirements.txt">
mcp>=1.0.0
pathlib>=1.0.1
typing>=3.7.4.3 

  </file>
  <file path="test_mcp_server.py">
#!/usr/bin/env python3
"""
Test script for the Cursor DB MCP server.
This script starts the MCP server and performs tests using the MCP Python SDK.
"""

import subprocess
import time
import sys
import os
import json
import asyncio
from pathlib import Path

# Import MCP client libraries with correct paths
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def test_mcp_server():
    """Test the MCP server using the Python SDK"""
    print("Starting Cursor DB MCP server test...")
    
    try:
        print("\nTesting MCP server with the Python SDK...")
        
        # Use stdio_client to start the server and connect to it
        server_params = StdioServerParameters(
            command=sys.executable,
            args=["cursor-db-mcp-server.py"],
            env=None
        )
        
        async with stdio_client(server_params) as (read, write):
            print("✅ Successfully started MCP server process")
            
            async with ClientSession(read, write) as session:
                # Initialize the connection
                await session.initialize()
                print("✅ Successfully initialized connection to MCP server")
                
                # Test 1: List available resources
                print("\n1. Testing resource listing...")
                resources = await session.list_resources()
                
                if resources and any(hasattr(r, 'uri') and "cursor://projects" in r.uri for r in resources):
                    print("✅ Successfully listed resources")
                    print(f"Resources: {[getattr(r, 'uri', str(r)) for r in resources]}")
                else:
                    print("❌ Failed to find expected resources")
                    print(f"Resources found: {resources}")
                
                # Test 2: List available tools
                print("\n2. Testing tool listing...")
                tools = await session.list_tools()
                
                if tools and any(hasattr(t, 'name') and "query_table" in t.name for t in tools):
                    print("✅ Successfully listed tools")
                    print(f"Tools: {[getattr(t, 'name', str(t)) for t in tools]}")
                else:
                    print("❌ Failed to find expected tools")
                    print(f"Tools found: {tools}")
                
                # Test 3: List available prompts
                print("\n3. Testing prompt listing...")
                prompts = await session.list_prompts()
                
                if prompts and any(hasattr(p, 'name') and "explore_cursor_projects" in p.name for p in prompts):
                    print("✅ Successfully listed prompts")
                    print(f"Prompts: {[getattr(p, 'name', str(p)) for p in prompts]}")
                else:
                    print("❌ Failed to find expected prompts")
                    print(f"Prompts found: {prompts}")
                
                # Test 4: Call a tool
                print("\n4. Testing tool execution...")
                try:
                    # Get list of projects first
                    projects_result = await session.call_tool("cursorprojects")
                    
                    if projects_result and isinstance(projects_result, list):
                        print("✅ Successfully called cursorprojects tool")
                        print(f"Projects: {projects_result}")
                        
                        # If we have projects, try querying one
                        if projects_result:
                            project_name = projects_result[0]  # Use the first project
                            query_result = await session.call_tool(
                                "query_table", 
                                arguments={
                                    "project_name": project_name,
                                    "table_name": "ItemTable",
                                    "query_type": "get_all",
                                    "limit": 5
                                }
                            )
                            
                            if query_result:
                                print("✅ Successfully queried project database")
                                print(f"Query result: {query_result[:2]}...")  # Show first 2 items
                            else:
                                print("❌ Failed to query project database")
                    else:
                        print("❌ Failed to call cursorprojects tool")
                        print(f"Result: {projects_result}")
                except Exception as e:
                    print(f"❌ Error calling tool: {e}")
                
                # Test 5: Read a resource
                print("\n5. Testing resource reading...")
                try:
                    # Try to read the projects resource
                    content, mime_type = await session.read_resource("cursor://projects")
                    
                    if content:
                        print("✅ Successfully read cursor://projects resource")
                        print(f"Content type: {mime_type}")
                        print(f"Content preview: {content[:100]}...")  # Show first 100 chars
                    else:
                        print("❌ Failed to read cursor://projects resource")
                except Exception as e:
                    print(f"❌ Error reading resource: {e}")
        
        print("\nAll tests completed!")
        
    except Exception as e:
        print(f"Error during testing: {e}")
        
    print("Test completed.")


def main():
    """Main entry point"""
    asyncio.run(test_mcp_server())


if __name__ == "__main__":
    main()   </file>
</files>
