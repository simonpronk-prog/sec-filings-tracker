#!/bin/bash
perl -i -pe 's/await fetch\`\$\{/await fetch\(\`\$\{/g' App.js
