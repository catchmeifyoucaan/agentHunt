#!/bin/bash
for file in src/services/three-agent/*.ts; do
  perl -i -pe 's/llmEngine\.complete\((.*?), \{[^}]*\}\)/llmEngine.complete(\1)/gs' "$file"
done
