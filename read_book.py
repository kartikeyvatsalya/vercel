import docx

def read_docx(file_path):
    doc = docx.Document(file_path)
    full_text = []
    for para in doc.paragraphs:
        if para.text.strip():
            full_text.append(para.text.strip())
            if len(full_text) > 300: # read up to 300 paragraphs
                break
    return '\n'.join(full_text)

text = read_docx('BRAHMAND_Astronomy_Handbook_v6.docx')
with open('book_extract.txt', 'w', encoding='utf-8') as f:
    f.write(text)
