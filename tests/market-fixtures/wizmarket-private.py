import re

WIZMARKET_COMMIT = "7e685187e590eb4d652dfd5b1c7e0c48adf8fb3b"
PRIVATE = [
    ("a token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}"
                           r"|xox[abposr]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}"
                           r"|npm_[A-Za-z0-9]{30,}|(?:AKIA|ASIA)[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.)")),
    ("a token", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----|[A-Za-z][A-Za-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@")),
    ("a token", re.compile(r"(?i)\b(?:password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret"
                           r"|auth[_-]?token|access[_-]?token)\b\s*[:=]\s*\S|\bbearer\s+[A-Za-z0-9._~+/-]{16,}")),
    ("a private id", re.compile(r"\bthr_[A-Za-z0-9]|\b(?:proj|prj|mch|usr|acct|auto|sess?|sbx)_[A-Za-z0-9]"
                                r"|\bcr_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}"
                                r"|\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")),
    ("a machine path", re.compile(r"(?<![\w.~%/-])/(?:home|Users|root|tmp|var/folders|private/var)/"
                                  r"|(?<![A-Za-z0-9])[A-Za-z]:\\")),
]
