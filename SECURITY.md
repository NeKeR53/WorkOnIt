# Politique de sécurité

## Versions supportées

| Version              | Support |
| -------------------- | ------- |
| Branche `main`       | Oui     |
| Dernière release     | Oui     |
| Versions antérieures | Non     |

## Signaler une vulnérabilité

Utilisez exclusivement le formulaire privé
[GitHub Security Advisory](https://github.com/NeKeR53/WorkOnIt/security/advisories/new).
N'ouvrez pas d'issue publique avant publication coordonnée du correctif.

Incluez version, plateforme, impact, prérequis, étapes de reproduction et preuve
de concept minimale. Supprimez secrets et données personnelles.

Un mainteneur vise un accusé de réception sous sept jours. La qualification,
le calendrier de correction et la divulgation coordonnée dépendent de l'impact.

## Modèle de confiance

WorkOnIt exécute localement des scripts choisis par l'utilisateur. Ces scripts
héritent des permissions du compte utilisateur et ne sont pas isolés par une
sandbox applicative. N'activez jamais une commande importée sans examiner son
contenu. Les archives `.workonit` ne constituent pas une signature d'origine.

Les secrets sont stockés dans le coffre du système et injectés uniquement aux
commandes qui les référencent. Les logs tentent de les masquer, sans pouvoir
garantir la détection de toutes transformations possibles d'un secret.

## Avis transitifs connus

`deny.toml` documente les avis RustSec ignorés. Ils concernent actuellement des
dépendances non maintenues héritées du backend Tauri/GTK3, sans version corrigée,
et non des vulnérabilités exploitables connues. Toute nouvelle vulnérabilité ou
tout avis disposant d'une mise à niveau sûre fait échouer l'audit automatisé.

## Périmètre

Sont particulièrement utiles: contournement de confirmation, exposition de
secret, exécution non sollicitée, traversée de chemin, archive malveillante et
compromission du mécanisme de release. L'ingénierie sociale et les scripts
explicitement exécutés après examen ne sont pas, seuls, des vulnérabilités.
