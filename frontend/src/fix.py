with open('App.js', 'r') as f:
    content = f.read()

# Replace the bug
content = content.replace('await fetch`', 'await fetch(')

with open('App.js', 'w') as f:
    f.write(content)

print("Fixed!")
