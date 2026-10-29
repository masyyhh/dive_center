import { z } from 'zod';
import { additionalDisclaimerTranslations } from './waterSportsTranslations';
import { boundedArray } from '../utils/validation';
import { isBusinessDate } from '../utils/dates';

export const formTypeSchema = z.enum(['PARTICIPATION', 'SNORKELING', 'GEAR_RENTAL', 'AID_GEAR']);
export const documentKind = (type: string) => type === 'SNORKELING' ? 'SNORKELING' : 'PARTICIPATION';
export const languageSchema = z.string().trim().min(2).max(35).regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
export const dateSchema = z.string().refine(isBusinessDate, 'Use a valid calendar date.');
export const staffFieldsSchema = z.object({
  checkNumber: z.string().trim().max(100).default(''),
  maskNumber: z.string().trim().max(100).default(''),
  finsNumber: z.string().trim().max(100).default(''),
  rentalDuration: z.string().trim().max(200).default(''),
  returnDate: z.union([dateSchema, z.literal('')]).default(''),
  notes: z.string().trim().max(1000).default(''),
}).strict();
const point = z.tuple([z.number().finite().min(0).max(1000), z.number().finite().min(0).max(300)]);
export const signatureSchema = boundedArray(boundedArray(point, 500), 50).refine(strokes => {
  const points = strokes.flat();
  return points.length >= 2 && points.length <= 2000 && points.some(p => Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) >= 5);
}, 'Draw a signature.');
export const submissionSchema = z.object({
  candidateId: z.string().uuid(), documentId: z.string().uuid(),
  acknowledged: z.literal(true), isMinor: z.boolean(),
  guardianName: z.string().trim().max(300).default(''),
  signature: signatureSchema,
}).strict().superRefine((value, ctx) => {
  if (value.isMinor && !value.guardianName) ctx.addIssue({ code: 'custom', path: ['guardianName'], message: 'A parent or guardian must enter their name and sign for a participant under 18.' });
});

// Transcribed from the supplied Vilu Reef forms; each published translation is versioned separately.
export const participationText = `1. I declare that I am participating in the Sun Siyam Vilu Reef Water Sports programs at my own risk and under no coercion from Sun Siyam Vilu Reef Water Sports. I am aware that I have to check the equipment before using it and report any possible defects to the Water Sports center.

2. I am aware that the use of windsurfing and other water sports equipment requires basic skills and that individuals are not allowed to teach themselves or others for safety reasons. Sun Siyam Vilu Reef Water Sports will not be held liable for any injury or accident arising from self-negligence.

3. I am liable for any self-caused damages to myself, materials and equipment.

4. I confirm that I know how to swim and am able to swim by myself for a minimum of 15 (fifteen) minutes.

5. I declare that I am under no medical obligation and have no objection from my health practitioner to participate in any of the Sun Siyam Vilu Reef Water Sports programs.

6. I am aware that I have to wear a water sports life vest at all times and agree to comply with it.

7. I was made aware of the water sports area and the areas restricted to every particular activity that I will be participating in. A breach of the restricted area will incur a reclaim of equipment.

8. I have been made aware of the emergency procedure and know how to use the emergency signal (cross hands above head) to indicate that I need help or rescue.

9. I declare that I have received an adequate level of training and explanation for the activity that I am to participate in.

10. I will strictly follow the directions given to me by the Sun Siyam Vilu Reef Water Sports staff. I am aware that swimmers, divers and snorkelers have absolute priority and that I must give way to them at all times. If I disregard these rules, the water sports staff have the authority to ban or restrict me from water sport activities.

11. Sun Siyam Vilu Reef Water Sports center will not be held liable for any damage, loss, delay or unexpected events arising from force majeure (bad weather, sea current, wind, etc.).

12. I must at all times stay within sight of the instructor or person in charge. I am not permitted to visit other islands on any water sport vessel without prior permission. Failure to comply will incur a redeem of the equipment, chargeable at USD 40.00 and applicable tax.

13. If the hire period for any equipment or activity is exceeded, I will be charged for an extra period of hire for the activity involved.

14. The renter will be held liable for any self-caused capsizing of the catamaran or jet ski. Water Sports will charge USD 40.00 and applicable tax for cleaning the jet ski and checking the catamaran due to such an incident. If any damage occurs, I will pay the cost of rectification.

15. Should a reclaim of equipment have to be carried out due to distress involving any water sport equipment, I agree to be charged USD 40.00 and applicable tax.

16. Participants under 18 years of age must have the signature of their parent or guardian.

17. With my signature, I accept the terms and conditions set forth by Sun Siyam Vilu Reef Water Sports center, stated above, in order to participate in their activities.`;
export const snorkelingText = `I, the undersigned participant, acknowledge and understand that snorkeling involves inherent risk, including but not limited to:
• Strong currents, waves or changing weather conditions.
• Marine life interactions, including potential stings, bites or other injuries.
• Lack of individual fitness.

I confirm that I am in good health and do not have any medical conditions (such as heart or respiratory conditions, epilepsy, or other serious illnesses) that may affect my ability to participate in snorkeling activities. I also affirm that I am a competent swimmer or have received adequate instruction and feel comfortable participating in this activity.

I voluntarily assume full responsibility for my participation in this snorkeling excursion and agree to release, waive and discharge Sun Siyam Vilu Reef, its owners, employees, affiliates and partners from any liability, claims, or damages that may arise from my participation, including those resulting from negligence.

I understand and agree that I must follow all the safety instructions given by the guide.

Acknowledgement
I have read and understood this disclaimer form. With my signature, I hereby accept the terms and conditions set forth by Sun Siyam Vilu Reef.

Participants under 18 must have a parent or guardian sign.`;

const participationGerman = `1. Ich erkläre, dass ich auf eigenes Risiko und ohne Zwang durch Sun Siyam Vilu Reef Water Sports an dessen Wassersportprogrammen teilnehme. Ich muss die Ausrüstung vor der Benutzung prüfen und mögliche Mängel dem Wassersportzentrum melden.

2. Mir ist bewusst, dass Windsurfen und die Benutzung anderer Wassersportgeräte Grundkenntnisse erfordern. Aus Sicherheitsgründen ist es nicht erlaubt, sich selbst oder andere zu unterrichten. Sun Siyam Vilu Reef Water Sports haftet nicht für Verletzungen oder Unfälle infolge eigener Fahrlässigkeit.

3. Ich hafte für alle von mir selbst verursachten Schäden an meiner Person, an Materialien und an der Ausrüstung.

4. Ich bestätige, dass ich schwimmen kann und mindestens 15 (fünfzehn) Minuten selbstständig schwimmen kann.

5. Ich erkläre, dass keine medizinischen Einschränkungen bestehen und mein behandelnder Arzt keine Einwände gegen meine Teilnahme an den Wassersportprogrammen von Sun Siyam Vilu Reef hat.

6. Mir ist bewusst, dass ich jederzeit eine Wassersport-Rettungsweste tragen muss, und ich verpflichte mich dazu.

7. Ich wurde über das Wassersportgebiet und die für die jeweilige Aktivität gesperrten Bereiche informiert. Bei einem Verstoß wird die Ausrüstung zurückgeholt.

8. Ich wurde über das Notfallverfahren informiert und weiß, wie ich das Notsignal (über dem Kopf gekreuzte Hände) benutze, um Hilfe oder Rettung anzufordern.

9. Ich erkläre, dass ich eine ausreichende Einweisung und Erklärung für die Aktivität erhalten habe, an der ich teilnehmen werde.

10. Ich werde die Anweisungen des Wassersportpersonals von Sun Siyam Vilu Reef strikt befolgen. Schwimmer, Taucher und Schnorchler haben absoluten Vorrang; ich muss ihnen jederzeit ausweichen. Bei Missachtung dieser Regeln darf das Personal mich von Wassersportaktivitäten ausschließen oder meine Teilnahme einschränken.

11. Das Wassersportzentrum von Sun Siyam Vilu Reef haftet nicht für Schäden, Verluste, Verzögerungen oder unerwartete Ereignisse durch höhere Gewalt (schlechtes Wetter, Meeresströmung, Wind usw.).

12. Ich muss jederzeit in Sichtweite des Ausbilders oder der verantwortlichen Person bleiben. Ohne vorherige Erlaubnis darf ich mit keinem Wassersportfahrzeug andere Inseln besuchen. Bei einem Verstoß wird die Ausrüstung zurückgeholt; hierfür werden USD 40,00 zuzüglich der geltenden Steuer berechnet.

13. Wird die Mietdauer einer Ausrüstung oder Aktivität überschritten, wird mir eine zusätzliche Mietzeit für die betreffende Aktivität berechnet.

14. Der Mieter haftet für selbst verursachtes Kentern des Katamarans oder Jetskis. Für die dadurch notwendige Reinigung des Jetskis und Kontrolle des Katamarans berechnet das Wassersportzentrum USD 40,00 zuzüglich der geltenden Steuer. Bei Schäden trage ich die Reparaturkosten.

15. Muss Wassersportausrüstung aufgrund einer Notsituation zurückgeholt werden, erkläre ich mich mit einer Gebühr von USD 40,00 zuzüglich der geltenden Steuer einverstanden.

16. Teilnehmer unter 18 Jahren benötigen die Unterschrift eines Elternteils oder Erziehungsberechtigten.

17. Mit meiner Unterschrift akzeptiere ich die vorstehenden Bedingungen des Wassersportzentrums von Sun Siyam Vilu Reef für die Teilnahme an dessen Aktivitäten.`;
const participationFrench = `1. Je déclare participer aux programmes de sports nautiques de Sun Siyam Vilu Reef à mes propres risques et sans contrainte de la part de Sun Siyam Vilu Reef Water Sports. Je dois vérifier le matériel avant de l'utiliser et signaler tout défaut éventuel au centre de sports nautiques.

2. Je sais que la planche à voile et les autres équipements de sports nautiques nécessitent des compétences de base. Pour des raisons de sécurité, il est interdit d'apprendre seul ou d'enseigner à d'autres personnes. Sun Siyam Vilu Reef Water Sports ne sera pas tenu responsable des blessures ou accidents résultant de ma propre négligence.

3. Je suis responsable de tous les dommages que je cause moi-même à ma personne, aux matériels et aux équipements.

4. Je confirme savoir nager et pouvoir nager seul pendant au moins 15 (quinze) minutes.

5. Je déclare ne faire l'objet d'aucune restriction médicale et que mon professionnel de santé ne s'oppose pas à ma participation aux programmes de sports nautiques de Sun Siyam Vilu Reef.

6. Je sais que je dois porter un gilet de sauvetage pour sports nautiques à tout moment et je m'engage à respecter cette obligation.

7. J'ai été informé de la zone de sports nautiques et des zones interdites pour chaque activité à laquelle je participerai. Toute infraction entraînera la récupération de l'équipement.

8. J'ai été informé de la procédure d'urgence et je sais utiliser le signal d'urgence (mains croisées au-dessus de la tête) pour indiquer que j'ai besoin d'aide ou de secours.

9. Je déclare avoir reçu une formation et des explications suffisantes pour l'activité à laquelle je vais participer.

10. Je suivrai strictement les instructions du personnel de sports nautiques de Sun Siyam Vilu Reef. Les nageurs, plongeurs et pratiquants de snorkeling ont une priorité absolue et je dois leur céder le passage à tout moment. En cas de non-respect de ces règles, le personnel peut m'interdire les activités de sports nautiques ou en limiter l'accès.

11. Le centre de sports nautiques de Sun Siyam Vilu Reef ne sera pas tenu responsable des dommages, pertes, retards ou événements imprévus résultant d'un cas de force majeure (mauvais temps, courants marins, vent, etc.).

12. Je dois rester à tout moment à portée de vue du moniteur ou de la personne responsable. Je ne suis pas autorisé à visiter d'autres îles avec un engin de sports nautiques sans autorisation préalable. Tout manquement entraînera la récupération du matériel, facturée 40,00 USD, plus les taxes applicables.

13. Si je dépasse la durée de location d'un équipement ou d'une activité, une période de location supplémentaire me sera facturée pour l'activité concernée.

14. Le locataire sera responsable de tout chavirement du catamaran ou du jet-ski qu'il aura lui-même causé. Le centre facturera 40,00 USD, plus les taxes applicables, pour le nettoyage du jet-ski et la vérification du catamaran à la suite d'un tel incident. En cas de dommages, je paierai le coût des réparations.

15. Si le matériel de sports nautiques doit être récupéré à la suite d'une situation de détresse, j'accepte de payer 40,00 USD, plus les taxes applicables.

16. Les participants de moins de 18 ans doivent obtenir la signature d'un parent ou de leur représentant légal.

17. Par ma signature, j'accepte les conditions ci-dessus du centre de sports nautiques de Sun Siyam Vilu Reef afin de participer à ses activités.`;
const snorkelingGerman = `Ich, der unterzeichnende Teilnehmer, erkenne an und verstehe, dass Schnorcheln mit eigenen Risiken verbunden ist, insbesondere:
• Starke Strömungen, Wellen oder wechselnde Wetterbedingungen.
• Begegnungen mit Meerestieren, die zu Stichen, Bissen oder anderen Verletzungen führen können.
• Mangelnde körperliche Fitness.

Ich bestätige, dass ich gesund bin und keine Erkrankungen habe (wie Herz- oder Atemwegserkrankungen, Epilepsie oder andere schwere Erkrankungen), die meine Fähigkeit zur Teilnahme am Schnorcheln beeinträchtigen könnten. Ich bestätige außerdem, dass ich sicher schwimmen kann oder eine ausreichende Einweisung erhalten habe und mich bei dieser Aktivität wohlfühle.

Ich übernehme freiwillig die volle Verantwortung für meine Teilnahme an diesem Schnorchelausflug und erkläre mich bereit, Sun Siyam Vilu Reef, seine Eigentümer, Mitarbeiter, verbundenen Unternehmen und Partner von jeglicher Haftung sowie von Ansprüchen oder Schäden freizustellen, die sich aus meiner Teilnahme ergeben können, einschließlich solcher, die auf Fahrlässigkeit beruhen.

Ich verstehe und akzeptiere, dass ich alle Sicherheitsanweisungen des Guides befolgen muss.

Bestätigung
Ich habe dieses Haftungsausschlussformular gelesen und verstanden. Mit meiner Unterschrift akzeptiere ich die von Sun Siyam Vilu Reef festgelegten Bedingungen.

Für Teilnehmer unter 18 Jahren muss ein Elternteil oder Erziehungsberechtigter unterschreiben.`;
const snorkelingFrench = `Je soussigné, participant, reconnais et comprends que le snorkeling comporte des risques inhérents, notamment :
• Des courants forts, des vagues ou des conditions météorologiques changeantes.
• Des interactions avec la vie marine pouvant provoquer des piqûres, morsures ou autres blessures.
• Une condition physique insuffisante.

Je confirme être en bonne santé et ne souffrir d'aucune affection (telle qu'une maladie cardiaque ou respiratoire, de l'épilepsie ou une autre maladie grave) susceptible d'affecter ma capacité à participer aux activités de snorkeling. Je confirme également être un nageur compétent ou avoir reçu une instruction suffisante et me sentir à l'aise pour participer à cette activité.

J'assume volontairement l'entière responsabilité de ma participation à cette excursion de snorkeling et accepte de dégager Sun Siyam Vilu Reef, ses propriétaires, employés, sociétés affiliées et partenaires de toute responsabilité, réclamation ou dommage pouvant résulter de ma participation, y compris ceux résultant d'une négligence.

Je comprends et accepte de suivre toutes les consignes de sécurité données par le guide.

Reconnaissance
J'ai lu et compris ce formulaire de décharge. Par ma signature, j'accepte les conditions établies par Sun Siyam Vilu Reef.

Pour les participants de moins de 18 ans, un parent ou représentant légal doit signer.`;

export const defaultDisclaimerDocuments = (kind: string) => [
  { language: 'en', languageName: 'English', title: kind === 'SNORKELING' ? 'Snorkeling excursion disclaimer' : 'Water sports conditions of participation', body: kind === 'SNORKELING' ? snorkelingText : participationText },
  { language: 'de', languageName: 'Deutsch', title: kind === 'SNORKELING' ? 'Haftungsausschluss für Schnorchelausflüge' : 'Teilnahmebedingungen für Wassersport', body: kind === 'SNORKELING' ? snorkelingGerman : participationGerman },
  { language: 'fr', languageName: 'Français', title: kind === 'SNORKELING' ? 'Décharge pour les excursions de snorkeling' : 'Conditions de participation aux sports nautiques', body: kind === 'SNORKELING' ? snorkelingFrench : participationFrench },
  ...additionalDisclaimerTranslations(kind),
].map((doc, index) => ({ ...doc, id: `a0000000-0000-4000-8000-0000000000${kind === 'SNORKELING' ? '1' : '0'}${index + 1}` }));
