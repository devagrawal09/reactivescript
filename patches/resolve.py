import re,sys
for p in sys.argv[1:]:
    s=open(p).read()
    pat=re.compile(r"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", re.S)
    def r(m):
        a,b=m.group(1),m.group(2)
        print("---",p); print(a); print("==="); print(b)
        return a+b
    s=pat.sub(r,s); open(p,'w').write(s)
