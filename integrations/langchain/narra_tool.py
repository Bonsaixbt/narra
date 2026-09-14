"""narra as LangChain tools. Requires the narra CLI on PATH (npm i -g narrahood) or npx.

    from narra_tool import narra_now, narra_coin, narra_flow, narra_why
    agent = create_react_agent(llm, [narra_now, narra_coin, narra_flow, narra_why])
"""
import json
import shutil
import subprocess

from langchain_core.tools import tool

_BIN = ["narra"] if shutil.which("narra") else ["npx", "-y", "narrahood"]


def _run(*args: str) -> str:
    out = subprocess.run([*_BIN, *args, "--json", "--no-color"], capture_output=True, text=True, timeout=300)
    if out.returncode >= 10:
        return json.dumps({"error": out.stderr.strip()[:500]})
    return out.stdout


@tool
def narra_now(window: str = "60m") -> str:
    """Which metas are live on Pons v2 / Robinhood Chain right now (HOT, EMERGING, ROTATING, COOLING, DEAD). window: 15m, 60m or 4h."""
    return _run("now", "--window", window)


@tool
def narra_coin(address: str, window: str = "60m") -> str:
    """Verdict IN / EDGE / OUT / ORPHAN / NOT_PONS for a Pons v2 contract address, with reasons. Call this first for any 0x address. IN is membership in a live meta, not a recommendation."""
    return _run("coin", address, "--window", window)


@tool
def narra_flow(window: str = "60m") -> str:
    """Where repeat buyers and deployers are moving between metas (edges A→B)."""
    return _run("flow", "--window", window)


@tool
def narra_why(slug: str, window: str = "60m") -> str:
    """Why a meta is named and grouped that way: tags, example tickers, members, links, flow."""
    return _run("why", slug, "--window", window)
