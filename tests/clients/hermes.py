"""Invoke AgoraFab tools using the installed Hermes Agent MCP transport."""

import asyncio
import json
import logging
import os
import sys

from tools.mcp_tool import MCPServerTask


async def main():
    logging.disable(logging.CRITICAL)
    request = json.load(sys.stdin)
    token = os.environ.pop('AGORAFAB_CLIENT_TOKEN')
    task = MCPServerTask('agorafab')
    results = []
    try:
        await asyncio.wait_for(task.start({
            'url': request['endpoint'],
            'headers': {'Authorization': f'Bearer {token}'},
            'connect_timeout': 8,
            'strict_redirect_headers': True,
        }), timeout=12)
        if task.session is None:
            raise RuntimeError('Hermes streamable HTTP connection unavailable.')
        for call in request['calls']:
            result = await asyncio.wait_for(task.session.call_tool(
                call['name'], arguments=call['arguments'],
            ), timeout=12)
            results.append(result.model_dump(mode='json', by_alias=True, exclude_none=True))
    finally:
        await task.shutdown()
    print(json.dumps(results))


if __name__ == '__main__':
    asyncio.run(main())
