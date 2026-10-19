# Documentation

Homelab Tools réunit deux rôles d'un même serveur, déployés séparément, et un agent :

- le **monitoring** supervise les machines et les services, alerte, publie une page de statut et expose l'API utilisée par les apps et la gestion ;
- la **gestion** tient l'inventaire, le réseau, les déploiements et les tâches, et pilote Proxmox et Webmin ;
- l'**agent** (Rust) remonte l'état de chaque machine au monitoring.

## Par où commencer

| Je veux… | Lire |
|---|---|
| installer le serveur, le mettre derrière un reverse proxy, le mettre à jour | [README](../README.md) |
| comprendre comment tout se parle (flux, authentification, temps réel, sécurité, ports) | [Architecture et communications](ARCHITECTURE.md) |
| utiliser le monitoring | [Guide du monitoring](MONITORING.md) |
| utiliser la gestion | [Guide de la gestion](GESTION.md) |
| installer l'agent sur une machine, un parc, des conteneurs | [Déployer l'agent](AGENT.md) |
| intégrer l'agent à un playbook | [Ansible](ANSIBLE.md) |
| surveiller un routeur ou un switch (débit, état des interfaces) | [Sondes SNMP](SNMP.md) |
| interroger le monitoring depuis un script ou un outil | [API du monitoring](API.md) |
| développer l'app iOS, iPadOS ou macOS | [Applications natives](API-APPLE.md) |

## Points clés

- **Deux rôles, deux machines.** Le monitoring (VPS) doit rester joignable quand le homelab tombe ; la gestion vit dans le homelab. Les deux peuvent partager un hôte avec deux ports différents.
- **Les agents ne parlent qu'au monitoring.** La gestion lit l'état des machines auprès du monitoring, avec un compte du monitoring.
- **Pas de jeton à copier pour la gestion ni pour l'app** : elles se connectent avec un identifiant et un mot de passe, même quand l'API publique est désactivée.
- **Temps réel** : le web et l'app reçoivent un flux d'événements et ne rechargent que ce qui a changé ; en arrière-plan, l'app est réveillée par les notifications push.
- **Proxmox reste indépendant** de l'inventaire et du monitoring.
- **Secrets chiffrés, jetons hachés, aucun travail root dans le serveur ni l'agent.**

L'interface et la documentation sont en français.
