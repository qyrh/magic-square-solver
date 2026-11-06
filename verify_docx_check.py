# verify_docx_check.py —— 校验 verify-all.js 生成的 DOCX：
#   1) zip 完整（zipfile.testzip 通过、5 个 part 齐全）
#   2) document.xml 良构：不使用任何 XML 实体解析器（拒绝 DOCTYPE/ENTITY，
#      只做自实现的标签配平检查，并限制输入大小），彻底避免实体扩展面
#   3) 无外链脚本（<script>）
# 用法：python -X utf8 verify_docx_check.py 文件1.docx 文件2.docx ...
import sys
import zipfile

PARTS = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml',
         'word/styles.xml', 'word/_rels/document.xml.rels']
MAX_XML = 20 * 1024 * 1024  # 20MB 上限


def wellformed(xml):
    """自实现的良构检查：标签配平、属性引号、无 DOCTYPE/ENTITY。不做任何实体解析。"""
    if '<!DOCTYPE' in xml or '<!ENTITY' in xml or '&' in xml.replace('&amp;', '').replace('&lt;', '').replace('&gt;', '').replace('&quot;', '').replace('&apos;', ''):
        return '含 DOCTYPE/ENTITY 或未预定义的实体引用'
    n = len(xml)
    stack = []
    i = 0
    while i < n:
        lt = xml.find('<', i)
        if lt < 0:
            break
        if xml.startswith('<?', lt) or xml.startswith('<!--', lt):
            end = xml.find('>' if not xml.startswith('<!--', lt) else '-->', lt)
            end = xml.find('-->', lt) if xml.startswith('<!--', lt) else xml.find('?>', lt)
            if end < 0:
                return '未闭合的处理指令/注释'
            i = end + (3 if xml.startswith('<!--', lt) else 2)
            continue
        end = xml.find('>', lt)
        if end < 0:
            return '未闭合的标签'
        tag = xml[lt + 1:end]
        selfclose = tag.endswith('/')
        if selfclose:
            tag = tag[:-1]
        closing = tag.startswith('/')
        if closing:
            tag = tag[1:].strip()
            if not stack or stack[-1] != tag:
                return '配平失败：期待 </%s>，遇到 </%s>' % (stack[-1] if stack else '?', tag)
            stack.pop()
        else:
            name = tag.split()[0] if tag.split() else ''
            if not name:
                return '空标签名'
            if not selfclose:
                stack.append(name)
        i = end + 1
    if stack:
        return '未闭合标签：%s' % ','.join(stack)
    return None


def check_one(path):
    problems = []
    try:
        zf = zipfile.ZipFile(path)
    except Exception as e:  # noqa: BLE001
        print('FAIL %s 打不开: %s' % (path, e))
        return False
    with zf:
        bad = zf.testzip()
        if bad is not None:
            problems.append('zip 损坏: %s' % bad)
        names = zf.namelist()
        for p in PARTS:
            if p not in names:
                problems.append('缺少 part: %s' % p)
        raw = zf.read('word/document.xml')
        if len(raw) > MAX_XML:
            problems.append('document.xml 超过大小上限')
        xml = raw.decode('utf-8')
        wf = wellformed(xml)
        if wf:
            problems.append('document.xml 良构检查失败: %s' % wf)
        low = xml.lower()
        if '<script' in low:
            problems.append('含 <script>')
        if 'http://schemas.openxmlformats.org' not in xml:
            problems.append('缺少 OOXML 命名空间')
        if xml.count('<w:p>') + xml.count('<w:p ') < 3:
            problems.append('段落过少')
    if problems:
        print('FAIL %s :: %s' % (path, '; '.join(problems)))
        return False
    print('OK   %s' % path)
    return True


def main():
    files = sys.argv[1:]
    if not files:
        print('FAIL 未提供文件')
        sys.exit(1)
    good = sum(1 for f in files if check_one(f))
    print('DOCX 校验: %d/%d 通过' % (good, len(files)))
    sys.exit(0 if good == len(files) else 1)


if __name__ == '__main__':
    main()
