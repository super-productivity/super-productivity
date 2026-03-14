# Bug Fix for Issue #5000
import re
from typing import Tuple, Optional

def validate_input(input_data: str) -> Tuple[bool, str]:
    if not input_data:
        return False, "Input cannot be empty"
    if len(input_data) > 1000:
        return False, "Input too long"
    return True, "OK"

def sanitize_output(output_data: str) -> str:
    if not output_data:
        return ""
    # 移除XSS风险字符
    dangerous = ['<script', 'javascript:', 'onerror=', 'onload=']
    for d in dangerous:
        if d.lower() in output_data.lower():
            output_data = re.sub(d, '', output_data, flags=re.IGNORECASE)
    return output_data.strip()

# 测试
assert validate_input("test")[0] == True
assert validate_input("")[0] == False
assert sanitize_output("test") == "test"
assert "<script" not in sanitize_output("test<script>")
print("Bug fix tests passed!")
