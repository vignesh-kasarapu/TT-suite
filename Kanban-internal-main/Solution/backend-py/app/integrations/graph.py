"""Microsoft Graph (directory search, profile, mail) - the suite's shared client (SUITE-CONTRACT
§2), re-exported so `app.integrations.graph` imports keep working."""

from suite_core.integrations.graph import GRAPH, GraphClient

__all__ = ["GRAPH", "GraphClient"]
