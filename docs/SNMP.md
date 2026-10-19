# Sondes SNMP : bande passante, interfaces et TP-Link Omada ER605

Ce guide explique comment surveiller un routeur ou un switch en SNMP avec Midnights Monitoring : débit entrant et sortant, volume de données, saturation du lien et état d'un tunnel WireGuard. Il prend pour exemple un **TP-Link Omada ER605 v2** (firmware 2.4.5), mais tout équipement qui publie l'IF-MIB fonctionne de la même façon.

Sommaire :

1. [Ce que mesure chaque sonde](#1-ce-que-mesure-chaque-sonde)
2. [Activer SNMP sur l'ER605](#2-activer-snmp-sur-ler605)
3. [Vérifier depuis un ordinateur](#3-vérifier-depuis-un-ordinateur)
4. [Les interfaces de l'ER605](#4-les-interfaces-de-ler605)
5. [Entrant ou sortant ?](#5-entrant-ou-sortant-)
6. [Créer les sondes pas à pas](#6-créer-les-sondes-pas-à-pas)
7. [WireGuard](#7-wireguard)
8. [Précision des mesures](#8-précision-des-mesures)
9. [Dépannage](#9-dépannage)
10. [Sécurité](#10-sécurité)
11. [API](#11-api)

## 1. Ce que mesure chaque sonde

Une sonde SNMP lit **une** valeur. Le champ *Mesure* du formulaire choisit laquelle :

| Mesure | `snmp_mode` | Ce qui est lu | Résultat |
|---|---|---|---|
| Valeur d'un OID | vide | un OID numérique quelconque | la valeur, avec l'unité choisie |
| Débit entrant d'une interface | `in` | `ifHCInOctets` (64 bits), sinon `ifInOctets` | débit en Mbit/s entre deux contrôles, volume en octets |
| Débit sortant d'une interface | `out` | `ifHCOutOctets`, sinon `ifOutOctets` | idem, dans l'autre sens |
| État d'une interface | `ifstatus` | `ifOperStatus` (+ octets reçus si un délai sans trafic est réglé) | opérationnel si l'interface est active |

Pour avoir les deux sens d'une interface, créez **deux sondes** (Entrant et Sortant) sur la même interface : la page *Bande passante* les regroupe sur une seule ligne, avec l'état de l'interface si une troisième sonde *État* existe.

## 2. Activer SNMP sur l'ER605

L'ER605 se configure soit dans son interface web (mode autonome), soit depuis un contrôleur Omada s'il y est adopté. Les intitulés exacts varient légèrement selon la version du firmware.

**Mode autonome** (interface web du routeur) : menu *System Tools* (Outils système) → *SNMP*.

1. Activez l'agent SNMP.
2. **SNMPv3, recommandé** : créez un utilisateur avec :
   - authentification **SHA** si le firmware la propose, sinon MD5 ;
   - un mot de passe d'au moins 8 caractères ;
   - chiffrement (*privacy*) **AES** si le firmware le propose, sinon DES.
3. **Ou SNMPv1/v2c** : une communauté en lecture seule, avec un nom difficile à deviner (jamais `public`).
4. Si une restriction d'accès est proposée (adresse ou réseau autorisé), limitez-la à l'adresse du serveur Midnights Monitoring.

**Avec un contrôleur Omada** : *Paramètres* → *Services* → *SNMP*. Le contrôleur ne propose en général que SNMPv1/v2c (communauté) ; dans ce cas, choisissez v2c dans la sonde.

Dans la sonde, reportez exactement les mêmes réglages : version, utilisateur, protocole et mot de passe d'authentification, protocole et mot de passe de chiffrement (ou la communauté en v2c). Un réglage qui ne correspond pas donne un délai dépassé ou une erreur d'authentification.

## 3. Vérifier depuis un ordinateur

Les commandes `snmpwalk` / `snmpget` (paquet `net-snmp`, déjà installé sur macOS) permettent de vérifier l'accès avant de créer les sondes. Remplacez l'utilisateur, les mots de passe et l'adresse.

```sh
# SNMPv3 avec authentification seule (authNoPriv), MD5
snmpwalk -v3 -l authNoPriv -u ngrt -a MD5 -A 'motdepasse' 192.168.50.1 1.3.6.1.2.1.2.2.1.2

# SNMPv3 avec authentification SHA et chiffrement AES (authPriv)
snmpwalk -v3 -l authPriv -u ngrt -a SHA -A 'motdepasse' -x AES -X 'motdepasse2' 192.168.50.1 1.3.6.1.2.1.2.2.1.2

# SNMPv2c
snmpwalk -v2c -c macommunaute 192.168.50.1 1.3.6.1.2.1.2.2.1.2
```

`1.3.6.1.2.1.2.2.1.2` est la liste des interfaces (`ifDescr`). D'autres OID utiles (ajoutez le numéro d'interface à la fin, par exemple `.3`) :

| OID | Nom | Contenu |
|---|---|---|
| `1.3.6.1.2.1.31.1.1.1.6` | `ifHCInOctets` | octets reçus (64 bits) |
| `1.3.6.1.2.1.31.1.1.1.10` | `ifHCOutOctets` | octets envoyés (64 bits) |
| `1.3.6.1.2.1.31.1.1.1.15` | `ifHighSpeed` | vitesse du lien en Mbit/s |
| `1.3.6.1.2.1.2.2.1.8` | `ifOperStatus` | 1 = active, 2 = inactive |
| `1.3.6.1.2.1.4.24.4.1.5` | `ipCidrRouteIfIndex` | interface de chaque route ; la route par défaut commence par `0.0.0.0.0.0.0.0` |
| `1.3.6.1.2.1.4.20.1.2` | `ipAdEntIfIndex` | interface de chaque adresse IPv4 du routeur |

Exemple : `snmpget … 192.168.50.1 1.3.6.1.2.1.31.1.1.1.6.3` donne les octets reçus par `default/eth1`. En relançant la commande pendant un téléchargement, la valeur augmente par paliers toutes les 10 à 20 secondes (voir [Précision des mesures](#8-précision-des-mesures)).

Pour mesurer un débit à la main, ne divisez pas par l'intervalle de votre boucle : le compteur ne bouge qu'à chaque rafraîchissement du routeur, si bien qu'une fenêtre de 5 s affiche tout le trafic d'un palier (parfois plus que la vitesse du port, 1 Gbit/s) et les suivantes 0. Divisez plutôt par le temps écoulé **entre deux changements du compteur**, comme le fait Midnights Monitoring (zsh, identifiants dans `~/.snmp/snmp.conf`) :

```sh
zmodload zsh/datetime
oid=1.3.6.1.2.1.31.1.1.1.6.3   # ifHCInOctets de eth1 (téléchargement) ; .10.3 pour l'envoi
p=$(snmpget -Oqv 192.168.50.1 $oid); pt=$EPOCHREALTIME
while sleep 1; do
  c=$(snmpget -Oqv 192.168.50.1 $oid); t=$EPOCHREALTIME
  (( c == p )) && continue          # pas encore rafraîchi par le routeur
  printf "%6.1f Mbit/s sur %4.1f s\n" $(( (c - p) * 8 / (t - pt) / 1e6 )) $(( t - pt ))
  p=$c; pt=$t
done
```

**Plus simple** : dans le formulaire de la sonde, saisissez l'adresse et les identifiants puis cliquez **Découvrir les interfaces**. Midnights Monitoring fait ces lectures pour vous et affiche le résultat (voir la section 6).

## 4. Les interfaces de l'ER605

L'ER605 fonctionne sous Linux et publie ses interfaces internes, préfixées par `default/` (l'espace de noms réseau du système). Voici la liste d'un ER605 v2 et ce qu'elle signifie :

| n° | `ifDescr` | Rôle | À surveiller ? |
|---|---|---|---|
| 1 | `default/lo` | boucle locale du système | non |
| 2 | `default/eth0` | interface physique interne : le lien vers le commutateur des ports LAN. Tout le trafic LAN y passe, VLAN confondus : pendant un téléchargement, son *Sortant* est le miroir de l'*Entrant* de `eth1` | rarement : préférez les `inf.N` |
| 3 | `default/eth1` | interface physique qui porte la **route par défaut : le WAN** | **oui, Entrant + Sortant** |
| 4 à 7 | `default/ip6tnl0`, `sit0`, `gre0`, `gretap0` | modèles de tunnels créés par le noyau Linux, inutilisés | non |
| 8 | `default/bond0` | modèle d'agrégation de liens du noyau, inutilisé | non |
| 9 | `default/inf` | interface parente des réseaux locaux (porte les VLAN) | non |
| 10 à 21 | `default/inf.1`, `inf.10`, `inf.30`… | **un réseau local (VLAN) chacun** : `inf.10` est le VLAN 10. `inf.0` et `inf.4094` sont probablement internes au firmware s'ils ne correspondent à aucun de vos réseaux | oui, pour le trafic d'un VLAN précis |
| 22 | `default/wg1` | l'interface **WireGuard** | oui, *État* avec délai sans trafic, et éventuellement Entrant/Sortant |

L'interface WAN se reconnaît à coup sûr à la **route par défaut** : la découverte l'indique (« route par défaut ») et la classe *WAN*. Si vous utilisez plusieurs WAN (ports 2 à 4 configurés en WAN), chacun apparaît comme une interface distincte, et en PPPoE une interface `ppp…` porte la connexion : surveillez alors celle-ci.

Dans le champ *Interface* de la sonde, vous pouvez écrire `default/eth1`, `eth1` (le préfixe `default/` est facultatif) ou le numéro `3`. Préférez le nom : le numéro peut changer après une mise à jour du firmware, alors que le nom est retrouvé automatiquement à chaque lecture.

## 5. Entrant ou sortant ?

*Entrant* et *Sortant* sont vus **depuis le routeur**, interface par interface :

| Interface | Entrant (`in`) | Sortant (`out`) |
|---|---|---|
| WAN (`eth1`) | **téléchargement** : ce qui arrive d'Internet | **envoi** : ce qui part vers Internet |
| LAN / VLAN (`inf.10`…) | ce que les appareils du réseau **envoient** | ce que les appareils du réseau **reçoivent** |
| WireGuard (`wg1`) | ce qui arrive du pair par le tunnel | ce qui part vers le pair |

Le sens est donc **inversé entre le WAN et un réseau local** : le téléchargement d'une image ISO par un ordinateur du VLAN 10 apparaît en *Entrant* sur `eth1` et en *Sortant* sur `inf.10`.

Pour votre connexion Internet, créez sur `eth1` :

- **Entrant** = votre débit descendant (téléchargement) ;
- **Sortant** = votre débit montant (envoi).

## 6. Créer les sondes pas à pas

1. *Sondes* → *Ajouter* → type **SNMP**.
2. *Équipement* : l'adresse du routeur (`192.168.50.1`), avec `:port` si ce n'est pas 161.
3. *Version* et identifiants comme configurés sur le routeur (section 2).
4. Cliquez **Découvrir les interfaces**. Le tableau liste, pour chaque interface :
   - son rôle probable (WAN, VPN, LAN) et ce que veulent dire *Entrant* et *Sortant* sur elle ;
   - son état, sa vitesse et ses adresses IP ;
   - le volume reçu et envoyé depuis le démarrage du routeur ;
   - les sondes qui la lisent déjà.

   Les interfaces système (tunnels du noyau, boucle locale) sont masquées par défaut.
5. Cliquez **Entrant**, **Sortant** ou **État** sur la ligne voulue : l'interface et la mesure sont remplies.
6. Nommez la sonde (« WAN ↓ téléchargement »), gardez un **intervalle de 60 s**, puis enregistrez.
7. Recommencez pour l'autre sens (« WAN ↑ envoi ») et, si besoin, pour `wg1`.

Réglages facultatifs :

| Champ | Mesures | Effet |
|---|---|---|
| Seuil haut / bas (Mbit/s) | Entrant, Sortant | état *dégradé* au-delà / en deçà |
| Seuil d'utilisation du lien (%) | Entrant, Sortant | état *dégradé* au-delà de ce pourcentage de la vitesse annoncée par le routeur (ex. 90) |
| Alerte si rien n'est reçu depuis (minutes) | État | panne si l'interface n'a rien reçu depuis ce délai (WireGuard, section 7) |

Les résultats apparaissent dans *Surveillance → Bande passante* (temps réel, 1 h à 30 jours, volume par jour) et dans les tableaux de bord du monitoring et de Midnights Management.

## 7. WireGuard

Une interface WireGuard reste **active** tant qu'elle est configurée, même si le pair ne répond plus : l'état seul ne dit pas si le tunnel fonctionne. Ce qui le prouve, c'est le trafic reçu du pair.

1. Activez un **keepalive persistant** (25 s) côté pair, pour que le tunnel reçoive quelque chose même au repos.
2. Créez une sonde *État d'une interface* sur `wg1` avec **Alerte si rien n'est reçu depuis : 3 minutes** (la découverte le propose quand vous cliquez *État* sur une interface VPN).

La sonde passe en panne majeure si l'interface est inactive, ou si rien n'a été reçu depuis le délai (« Interface wg1 active mais rien reçu depuis 4 min »).

## 8. Précision des mesures

- **Compteurs rafraîchis par paliers.** L'ER605 ne met à jour ses compteurs d'octets que toutes les 10 à 20 secondes. Une lecture entre deux rafraîchissements voit le même compteur. Midnights Monitoring attend alors le rafraîchissement suivant au lieu d'afficher 0 puis un faux pic, en sonde comme en temps réel. Gardez un intervalle d'au moins **60 s** : un relevé est le débit moyen entre deux contrôles, et l'écart dû aux paliers (au plus 20 s) pèse moins sur une minute.
- **Temps réel.** La vue *Temps réel* lit le routeur toutes les 2 secondes, mais elle ne peut pas être plus fine que ses paliers : la courbe change toutes les 10 à 20 secondes.
- **64 bits.** Les compteurs 64 bits sont utilisés en v2c et v3 ; en v1, ou si l'équipement n'en a pas, les compteurs 32 bits repassent par zéro toutes les 34 s à 1 Gbit/s. Ce passage est compté s'il reste plausible pour la vitesse du lien, sinon il est traité comme un redémarrage (relevé ignoré). Préférez v2c ou v3.
- **Volume.** Il est compté **à l'octet près** à partir des compteurs, à chaque relevé, puis cumulé par heure : les journées et les mois suivent le fuseau horaire choisi dans *Configuration*. Il est conservé selon la rétention des agrégats quotidiens (365 jours par défaut). Le comptage commence avec la sonde : rien n'est compté pendant un arrêt du serveur ou du routeur.
- **Pic.** Le pic affiché est la plus forte mesure de la période, c'est-à-dire le plus fort débit moyen entre deux contrôles. Les rafales plus courtes que l'intervalle n'apparaissent qu'en temps réel.
- **Unités.** L'interface affiche des octets par seconde (Ko/s, Mo/s, Go/s, 1 Mo = 10⁶ octets) ; l'API et les seuils sont en Mbit/s (1 Mo/s = 8 Mbit/s).
- **Renumérotation.** Chaque lecture relit le nom de l'interface avec le compteur. Si le routeur a renuméroté ses interfaces (mise à jour, tunnel recréé), la bonne interface est retrouvée aussitôt au lieu de lire la mauvaise.

## 9. Dépannage

| Message ou symptôme | Cause probable | Que faire |
|---|---|---|
| « Connexion SNMP impossible » / délai dépassé | SNMP désactivé, mauvaise adresse ou port, restriction d'accès, identifiants v3 refusés (un mauvais mot de passe v3 se traduit souvent par un délai) | vérifiez avec `snmpwalk` depuis la machine du serveur (section 3) |
| « Interface « X » introuvable. Interfaces vues : … » | nom mal saisi | reprenez un nom de la liste, ou utilisez *Découvrir les interfaces* |
| « Compteur pas encore rafraîchi par l'équipement » | intervalle plus court que les paliers du routeur | normal de temps en temps ; passez à 60 s si c'est fréquent |
| « Premier relevé, débit au prochain contrôle » | premier relevé après un démarrage, un redémarrage du routeur ou un changement d'équipement | attendez le contrôle suivant |
| « Compteur absent pour l'interface X » | interface supprimée (tunnel arrêté, VLAN supprimé) | elle sera retrouvée à sa réapparition |
| Le débit semble faux d'un facteur 8 | confusion bits / octets | 100 Mo/s = 800 Mbit/s |
| Le téléchargement apparaît en *Sortant* | la sonde lit une interface LAN | lisez le WAN (`eth1`), ou inversez les sondes (section 5) |
| WireGuard « opérationnel » alors que le tunnel est coupé | sonde *État* sans délai sans trafic | réglez le délai et le keepalive (section 7) |
| « La découverte » ne montre aucune adresse ni route | le routeur ne publie pas ces tables | sans conséquence : choisissez l'interface par son nom |

## 10. Sécurité

- Préférez **SNMPv3 avec authentification et chiffrement** (`authPriv`) : en v1/v2c, la communauté circule en clair, et en `authNoPriv` les réponses sont lisibles sur le réseau.
- Accès en **lecture seule**, limité à l'adresse du serveur. N'ouvrez jamais SNMP côté WAN.
- Les communautés et mots de passe SNMP sont **chiffrés** (AES-256-GCM) dans la base `hlm.db`, avec la clé `DATA_DIR/secret.key` ou `APP_SECRET`. Sauvegardez `secret.key` avec la base : sans elle, il faut ressaisir les mots de passe des sondes. Ils ne sont jamais renvoyés par l'interface ni par l'API.

## 11. API

Toutes les routes sont décrites dans la [référence de l'API](API.md) :

- `GET /api/v1/monitors` : les sondes, dont `config.snmp_mode`, `interface`, `max_percent` et `idle_minutes` ;
- `GET /api/v1/bandwidth` : débits, volumes par jour et vitesse du lien, par interface ;
- `GET /api/v1/bandwidth/live` : lecture immédiate des compteurs ;
- `GET /api/v1/snmp/devices` : les équipements lus par les sondes, avec toutes leurs interfaces (rôle probable, état, vitesse, adresses, route par défaut, volume depuis le démarrage, sondes associées).

Toutes demandent le scope `monitors:read`.
