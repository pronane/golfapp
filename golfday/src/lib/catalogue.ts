/**
 * Starter course catalogue.
 *
 * Par and stroke-index values below are plausible demo data modelled on the
 * published cards for these famous venues - they are NOT an official record.
 * In production you would import the real card from GolfCourseAPI (free key) or
 * let the event admin type the card in. See docs/INTEGRATIONS.md.
 */
export type CatalogueCourse = {
  name: string;
  club: string;
  address: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  par: number;
  /** par per hole, holes 1-18 */
  pars: number[];
  /** stroke index per hole, holes 1-18 */
  strokeIndexes: number[];
  tees: { name: string; colour: string; slope: number; rating: number; par: number; yardage: number }[];
};

const si = (values: number[]) => values;

export const CATALOGUE: CatalogueCourse[] = [
  {
    name: "Old Course",
    club: "St Andrews Links",
    address: "Pilmour House, St Andrews",
    city: "St Andrews",
    country: "Scotland",
    latitude: 56.3433,
    longitude: -2.8025,
    par: 72,
    pars: [4, 4, 4, 4, 5, 4, 4, 3, 4, 4, 3, 4, 4, 5, 4, 4, 4, 4],
    strokeIndexes: si([6, 12, 10, 8, 2, 14, 4, 16, 18, 7, 15, 3, 9, 1, 11, 13, 5, 17]),
    tees: [
      { name: "White", colour: "white", slope: 132, rating: 73.5, par: 72, yardage: 6721 },
      { name: "Yellow", colour: "yellow", slope: 128, rating: 71.8, par: 72, yardage: 6421 },
      { name: "Red", colour: "red", slope: 128, rating: 74.2, par: 72, yardage: 5811 },
    ],
  },
  {
    name: "West Course",
    club: "Wentworth Club",
    address: "Virginia Water, Surrey",
    city: "Virginia Water",
    country: "England",
    latitude: 51.3996,
    longitude: -0.5902,
    par: 72,
    pars: [4, 3, 4, 5, 4, 4, 3, 4, 4, 4, 4, 5, 4, 3, 4, 4, 5, 4],
    strokeIndexes: si([9, 15, 5, 3, 11, 1, 17, 7, 13, 8, 4, 12, 2, 18, 14, 6, 10, 16]),
    tees: [
      { name: "White", colour: "white", slope: 143, rating: 74.8, par: 72, yardage: 7315 },
      { name: "Yellow", colour: "yellow", slope: 137, rating: 72.6, par: 72, yardage: 6877 },
      { name: "Red", colour: "red", slope: 133, rating: 75.1, par: 72, yardage: 6120 },
    ],
  },
  {
    name: "Brabazon Course",
    club: "The Belfry",
    address: "Lichfield Road, Wishaw, Sutton Coldfield",
    city: "Sutton Coldfield",
    country: "England",
    latitude: 52.5599,
    longitude: -1.7354,
    par: 72,
    pars: [4, 4, 5, 4, 3, 4, 4, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5],
    strokeIndexes: si([8, 10, 2, 12, 16, 6, 14, 4, 18, 9, 1, 17, 7, 3, 11, 13, 15, 5]),
    tees: [
      { name: "White", colour: "white", slope: 136, rating: 74.1, par: 72, yardage: 7180 },
      { name: "Yellow", colour: "yellow", slope: 130, rating: 71.9, par: 72, yardage: 6712 },
      { name: "Red", colour: "red", slope: 126, rating: 73.4, par: 72, yardage: 5840 },
    ],
  },
  {
    name: "Old Course",
    club: "Walton Heath Golf Club",
    address: "Deans Lane, Walton on the Hill, Tadworth",
    city: "Tadworth",
    country: "England",
    latitude: 51.2815,
    longitude: -0.2419,
    par: 72,
    pars: [4, 4, 4, 4, 4, 3, 4, 5, 4, 4, 4, 3, 4, 4, 5, 4, 3, 5],
    strokeIndexes: si([7, 11, 1, 13, 5, 17, 9, 3, 15, 8, 6, 18, 12, 2, 10, 14, 16, 4]),
    tees: [
      { name: "White", colour: "white", slope: 138, rating: 74.2, par: 72, yardage: 7062 },
      { name: "Yellow", colour: "yellow", slope: 132, rating: 71.6, par: 72, yardage: 6616 },
      { name: "Red", colour: "red", slope: 129, rating: 74.0, par: 72, yardage: 5930 },
    ],
  },
  {
    name: "Old Course",
    club: "Sunningdale Golf Club",
    address: "Ridgemount Road, Sunningdale, Ascot",
    city: "Ascot",
    country: "England",
    latitude: 51.3962,
    longitude: -0.6329,
    par: 70,
    pars: [4, 3, 4, 4, 4, 4, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3],
    strokeIndexes: si([9, 17, 3, 11, 1, 7, 13, 15, 5, 6, 12, 2, 18, 8, 10, 16, 4, 14]),
    tees: [
      { name: "White", colour: "white", slope: 131, rating: 72.3, par: 70, yardage: 6625 },
      { name: "Yellow", colour: "yellow", slope: 127, rating: 70.5, par: 70, yardage: 6283 },
      { name: "Red", colour: "red", slope: 124, rating: 72.8, par: 70, yardage: 5661 },
    ],
  },
  {
    name: "Twenty Ten Course",
    club: "Celtic Manor Resort",
    address: "Coldra Woods, Newport",
    city: "Newport",
    country: "Wales",
    latitude: 51.6055,
    longitude: -2.9406,
    par: 71,
    pars: [4, 3, 4, 4, 5, 4, 3, 4, 5, 4, 3, 4, 4, 5, 4, 4, 3, 4],
    strokeIndexes: si([10, 16, 4, 12, 2, 8, 18, 6, 14, 7, 15, 3, 11, 1, 13, 9, 17, 5]),
    tees: [
      { name: "White", colour: "white", slope: 140, rating: 74.9, par: 71, yardage: 7349 },
      { name: "Yellow", colour: "yellow", slope: 134, rating: 72.2, par: 71, yardage: 6828 },
      { name: "Red", colour: "red", slope: 130, rating: 74.4, par: 71, yardage: 6012 },
    ],
  },
];
