"""The marking tools Claude gets: one per tool on the toolbar, and nothing else.

A small MCP server over stdio, started by the `claude` command for one marking
run. It holds no data: each call shows up in Claude's output stream, and
claude_marker.py turns that into a mark.
"""
import json
import sys

WHERE = {
    "page": {"type": "integer", "description": "Page number, from 0."},
    "line": {"type": "integer", "description": "Line number on that page, from lines.json."},
    "x": {"type": "number", "description": "On a page with no text lines: position across, 0 to 1."},
    "y": {"type": "number", "description": "On a page with no text lines: position down, 0 to 1."},
}
COMMENT = {"type": "string", "description": "A short, kind remark to the student, in English."}
TOOLS = {
    "tick": ("Tick a correct result.", False),
    "cross": ("Cross a mistake and say what is wrong.", True),
    "highlight": ("Highlight a passage to reread and say why.", True),
    "comment": ("Leave a remark with no symbol.", True),
    "circle": ("Circle a value or step that needs attention and say why.", True),
    "line": ("Underline something.", False),
    "arrow": ("Point an arrow at something and say why.", True),
}


def tool_list():
    tools = []
    for name, (description, needs_comment) in TOOLS.items():
        required = ["page", "comment"] if needs_comment else ["page"]
        schema = {"type": "object", "properties": {**WHERE, "comment": COMMENT}, "required": required}
        tools.append({"name": name, "description": description, "inputSchema": schema})
    return tools


def answer(request):
    method = request.get("method")
    if method == "initialize":
        return {"protocolVersion": request["params"].get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}}, "serverInfo": {"name": "marker", "version": "1"}}
    if method == "tools/list":
        return {"tools": tool_list()}
    if method == "tools/call":
        known = request["params"].get("name") in TOOLS
        return {"content": [{"type": "text", "text": "Marked." if known else "No such tool."}], "isError": not known}
    return {}


def main():
    for raw in sys.stdin:
        request = json.loads(raw)
        if "id" in request:  # anything without an id is a notification
            print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": answer(request)}), flush=True)


if __name__ == "__main__":
    main()
