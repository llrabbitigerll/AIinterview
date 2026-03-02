"""
Compatibility shim package for editor/static analysis.

This package provides thin wrapper modules so imports like
`import app.services.llm_service` resolve to the real code under
`server.app.services.*` for editors. Created for development convenience.
Remove these files before final packaging if you don't want devtools shims.
"""

# Package marker for editor/static analysis.
