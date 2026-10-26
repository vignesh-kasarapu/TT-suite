from app.schemas.base import CamelOut


class BulkImportRowErrorOut(CamelOut):
    """Node's validateRows hand-builds { row, employeeCode, errors } per bad
    row — row/errors are single words (case-ambiguous), employeeCode is
    genuinely camelCase. See app/schemas/base.py."""

    row: int
    employee_code: str
    errors: list[str]


class BulkImportResultOut(CamelOut):
    committed: bool
    errors: list[BulkImportRowErrorOut]
    imported_count: int
