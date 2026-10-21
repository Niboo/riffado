# Découpe et transcription asynchrones

## Utilisation

Dans la carte Transcription, « Split audio » prépare des morceaux de moins de vingt minutes. Les enregistrements Ogg/Opus sont découpés sans réencodage et conservés en `.ogg`, avec leurs canaux et leur qualité d’origine. Les autres formats conservent la conversion MP3 existante. Cette action ne contacte pas OpenAI. L’original est conservé. Les morceaux sont stockés dans le même stockage que les enregistrements (S3 ou disque local), indépendamment des fichiers temporaires de conversion.

Une barre compacte représente les morceaux, proportionnellement à leur durée. La couleur et une icône indiquent leur état. Le survol, le clic ou le clavier ouvrent les détails, l’erreur et le téléchargement ; le lecteur de l’original reste disponible. « Transcribe » prépare les morceaux si nécessaire lorsque le modèle utilise la diarisation OpenAI. Les autres fournisseurs gardent leur traitement actuel, exécuté en arrière-plan.

Les transcriptions manuelles sont mises en file et rendent immédiatement une réponse HTTP 202. Le navigateur interroge l’état toutes les trois secondes. Il peut être fermé ou rafraîchi sans arrêter le travail serveur. Un seul traitement par utilisateur est pris en charge à la fois. Le worker traite un travail à la fois par processus pour limiter la charge.

Les résultats OpenAI sont chiffrés et enregistrés après chaque morceau. « Resume transcription » réutilise les résultats terminés si le fournisseur, le modèle et la langue sont identiques. Une nouvelle transcription demandée après un succès remet les textes partiels à zéro, mais conserve les audios préparés. Les noms d’intervenants restent locaux à chaque morceau ; aucune identification de voix entre morceaux n’est garantie.

Si des morceaux MP3 existent déjà pour une source Opus, supprimer ces morceaux avant de relancer la découpe. Aucun repli automatique en MP3 n’est effectué si OpenAI refuse l’Opus. L’original plus les morceaux représentent environ deux fois le volume initial pour une source Opus, avec un léger surcoût de conteneur.

## Échecs et conservation

Un délai d’attente du fournisseur arrête le travail et affiche une erreur. Les morceaux et les résultats déjà enregistrés restent disponibles. Les tentatives automatiques du SDK OpenAI sont désactivées pour éviter de renvoyer silencieusement un même morceau. La limite implicite de cinq minutes de fetch sous Bun est désactivée ; le délai configuré par `WHISPER_REQUEST_TIMEOUT_MS` reste applicable.

Après un arrêt du serveur, le bail de traitement expire après deux minutes sans renouvellement. Le travail devient « failed ». L’utilisateur peut alors le reprendre. Le morceau dont la réponse n’avait pas été enregistrée peut être renvoyé et facturé à nouveau : aucune garantie d’exécution exactement une fois ne peut être donnée à travers l’API externe.

Les morceaux ne sont pas supprimés après un échec ou une réussite. Ils consomment donc du stockage supplémentaire. « Remove saved parts », après confirmation, supprime les morceaux et les transcriptions partielles, sans supprimer l’original ni la transcription complète. Une modification de l’audio source exige de supprimer les anciens morceaux avant de les préparer à nouveau.

Les sauvegardes ZIP incluent les morceaux et leurs textes disponibles, décrits dans `audioParts` du manifeste. La suppression d’un enregistrement entraîne leur nettoyage par le worker ; la suppression d’un compte inclut aussi leurs objets de stockage.

## Architecture et livraison

La table `audio_jobs` stocke la file, le bail, les morceaux et les résultats chiffrés. Les prises de travail sont atomiques dans PostgreSQL et les écritures sont conditionnées par un jeton de prise de travail. Toutes les routes de lecture et d’écriture vérifient l’utilisateur et l’enregistrement. Les clés de stockage et jetons de traitement ne sont pas exposés au navigateur.

Le worker est initialisé par `src/instrumentation.ts`, sans nouveau service ni nouvelle variable obligatoire. La migration additive 0039 crée uniquement cette table et ses index. Elle n’a pas été appliquée en production pendant le développement.

Le changement couvre les transcriptions manuelles de l’interface et leur route interne. Les appels directs du pipeline de synchronisation et de l’API publique ne sont pas convertis en travaux durables par cette première étape.

Les tests d’intégration peuvent utiliser une base PostgreSQL de test isolée : `AUDIO_JOB_TEST_DB_SOCKET=/tmp/riffado-audio-test pnpm test src/tests/audio-jobs.integration.test.ts`. Le rôle est `riffado_test`, la base `postgres`, le port 55439. Le schéma de base doit être créé au préalable dans cette base vide ; le test recrée la table de travaux et efface les données de test. Ne jamais viser une base réelle.

Le suivi de chaque morceau inclut son état, l’heure de début et de fin, le nombre de tentatives et une erreur exploitable en cas d’échec. Le morceau actif est identifié dans la barre ; les résultats terminés restent consultables pendant le reste du travail.

Les erreurs non classées conservent désormais un message détaillé limité à 600 caractères, avec masquage des URL et identifiants sensibles. Les anciennes erreurs déjà enregistrées ne peuvent pas être reconstituées : une nouvelle tentative est nécessaire. La coupe Opus inclut une marge de 50 ms pour éviter un morceau final parasite lié à l’alignement des paquets, sans réencodage ni suppression de paquets. Les morceaux déjà enregistrés ne sont pas modifiés.

## Navigation, lecture et mesures

La sélection d’un enregistrement est conservée dans `?recording=<id>`. Les liens acceptent l’ouverture dans un nouvel onglet ; les boutons précédent/suivant du navigateur restaurent la sélection. Un enregistrement ancien est rendu même au-delà du premier lot de la liste. Sa position verticale est mémorisée dans la session du navigateur lors du départ de page et restaurée au rafraîchissement, lorsque le navigateur autorise le stockage de session.

Le suivi des morceaux se trouve dans le lecteur audio, dans une section ouverte par défaut et repliable. Replier cette section ne suspend ni le travail ni son suivi. Les transcriptions partielles s’ouvrent dans une fenêtre de lecture défilante. Les titres des morceaux affichent le numéro et la durée ; les intervalles restent dans les détails. Le transcript principal n’a plus de petite zone de défilement imbriquée.

Le temps affiché est la différence entre le début et la fin de la dernière tentative réussie de chaque morceau ; le total additionne ces durées disponibles. Ce n’est ni la durée de l’audio ni le temps total avec les échecs et l’attente. Une durée manquante n’est pas inventée. Le coût est une estimation d’un passage sur les morceaux, calculée à partir d’un tarif de référence modifiable, initialisé à 0,006 USD/minute. Ce tarif de simulation n’est pas récupéré du compte fournisseur et n’est pas sauvegardé. Le calcul exclut les reprises, appels échoués, résumés et stockage ; il ne représente pas la facture.

Le choix de langue près du bouton Transcribe modifie explicitement la langue par défaut des prochaines transcriptions, en réutilisant le réglage existant. Choisir French pour une réunion française envoie `language=fr` à chaque morceau OpenAI. L’auto-détection reste disponible. La langue n’est pas une traduction ni une garantie de résultat parfait ; les transcriptions déjà stockées ne changent pas. Les couleurs sobres des intervenants sont réutilisées par numéro local, et chaque étiquette découpée indique son morceau : cela ne fusionne pas les identités entre morceaux ni ne limite artificiellement leur nombre. L’API OpenAI utilisée n’expose pas de paramètre pour imposer deux intervenants.

Référence : [langue et paramètres OpenAI](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).
