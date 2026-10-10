<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

Je voudrais créer une application web de management de mon homelab. En gros elle fonctionnera dans un conteneur docker ou un CT Proxmox avec une image OCI. Le but sera d'intégrer un inventaire complet de homelab (ajout de serveurs physiques, machines virtuelles, conteneurs, conteneurs Docker...) et aussi un suivi de déploiements qu'on peut éditer à la main. Une sorte d'IPAM, un petit homepage où je peux ajouter des raccourcis vers mes applications (ajoute dedans un fournisseur d'icones et la possibilité de pouvoir upload ses propres icones). J'aimerais aussi une intégration de Beszel, Maintenant et Patchmon pour centraliser le monitoring. Voici ce qu'il faudrait faire :
- Gestion inventaire homelab (ajout de serveurs physiques avec ip; nom; tags; VLAN; sous réseau... ajout de ct, conteneurs docker)
- Gestion déploiement (pour l'instant édition manuelle uniquement. permet d'ajouter une vm/ct/application/serveur physique à déployer, l'état du déploiement, ce qu'il faut faire etc...)
- Intégration du monitoring
- Un petit homepage avec les raccourcis vers mes applications
- Les taches à faire
- Un tableau de bord complet
- Créer une carte de homelab interactive
- Gestion multinodes de proxmox (si on est pas en mesure de créer un cluster proxmox car on a pas encore 3 nodes et si on ne veut pas déployer proxmox datacenter manager)

Je voudrais avoir quelque chose de complet.

Coté design je veux que tu reprenne exactement https://noe-georget.fr/graphique. Couleur d'accentuation #3fbfa6 et polices Geist et Geist Mono.
