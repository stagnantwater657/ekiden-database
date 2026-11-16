from pathlib import Path
p = Path("components/athlete-profile.tsx")
t = p.read_text(encoding="utf-8")
t = t.replace('import { formatPersonalBest, type PersonalBestEvent } from "../lib/athlete-facts";',
              'import { formatPersonalBest, personalBestStatus, type PersonalBestEvent } from "../lib/athlete-facts";')
p.write_text(t, encoding="utf-8", newline="\n")
