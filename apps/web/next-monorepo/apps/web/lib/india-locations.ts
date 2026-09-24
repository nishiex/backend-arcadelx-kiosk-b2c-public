/**
 * Indian states / union territories and a curated set of major cities for each,
 * used to drive the State → City cascading dropdowns on org creation forms.
 * Country is India-only for now.
 */
export type IndiaState = { name: string; cities: string[] }

export const INDIA_STATES: IndiaState[] = [
  { name: "Andhra Pradesh", cities: ["Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Kurnool", "Tirupati", "Kadapa", "Rajahmundry", "Kakinada", "Anantapur"] },
  { name: "Arunachal Pradesh", cities: ["Itanagar", "Naharlagun", "Pasighat", "Tawang", "Ziro", "Bomdila"] },
  { name: "Assam", cities: ["Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Nagaon", "Tinsukia", "Tezpur", "Bongaigaon"] },
  { name: "Bihar", cities: ["Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Purnia", "Darbhanga", "Bihar Sharif", "Arrah", "Begusarai"] },
  { name: "Chhattisgarh", cities: ["Raipur", "Bhilai", "Bilaspur", "Korba", "Durg", "Rajnandgaon", "Jagdalpur", "Raigarh"] },
  { name: "Goa", cities: ["Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda", "Bicholim"] },
  { name: "Gujarat", cities: ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar", "Gandhinagar", "Junagadh", "Anand", "Nadiad"] },
  { name: "Haryana", cities: ["Faridabad", "Gurugram", "Panipat", "Ambala", "Yamunanagar", "Rohtak", "Hisar", "Karnal", "Sonipat", "Panchkula"] },
  { name: "Himachal Pradesh", cities: ["Shimla", "Solan", "Dharamshala", "Mandi", "Kullu", "Manali", "Baddi", "Bilaspur"] },
  { name: "Jharkhand", cities: ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro Steel City", "Deoghar", "Hazaribagh", "Giridih"] },
  { name: "Karnataka", cities: ["Bengaluru", "Mysuru", "Hubballi", "Mangaluru", "Belagavi", "Kalaburagi", "Davanagere", "Ballari", "Shivamogga", "Tumakuru"] },
  { name: "Kerala", cities: ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam", "Kannur", "Alappuzha", "Palakkad", "Malappuram"] },
  { name: "Madhya Pradesh", cities: ["Bhopal", "Indore", "Jabalpur", "Gwalior", "Ujjain", "Sagar", "Dewas", "Satna", "Ratlam", "Rewa"] },
  { name: "Maharashtra", cities: ["Mumbai", "Pune", "Nagpur", "Nashik", "Thane", "Aurangabad", "Solapur", "Kolhapur", "Amravati", "Navi Mumbai", "Sangli"] },
  { name: "Manipur", cities: ["Imphal", "Thoubal", "Bishnupur", "Churachandpur", "Kakching"] },
  { name: "Meghalaya", cities: ["Shillong", "Tura", "Jowai", "Nongstoin", "Baghmara"] },
  { name: "Mizoram", cities: ["Aizawl", "Lunglei", "Champhai", "Serchhip", "Kolasib"] },
  { name: "Nagaland", cities: ["Kohima", "Dimapur", "Mokokchung", "Tuensang", "Wokha"] },
  { name: "Odisha", cities: ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur", "Puri", "Balasore", "Baripada"] },
  { name: "Punjab", cities: ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali", "Hoshiarpur", "Pathankot", "Moga"] },
  { name: "Rajasthan", cities: ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Bikaner", "Ajmer", "Bhilwara", "Alwar", "Sikar", "Sri Ganganagar"] },
  { name: "Sikkim", cities: ["Gangtok", "Namchi", "Gyalshing", "Mangan", "Rangpo"] },
  { name: "Tamil Nadu", cities: ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli", "Tiruppur", "Erode", "Vellore", "Thoothukudi"] },
  { name: "Telangana", cities: ["Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam", "Ramagundam", "Mahbubnagar", "Secunderabad"] },
  { name: "Tripura", cities: ["Agartala", "Udaipur", "Dharmanagar", "Kailashahar", "Belonia"] },
  { name: "Uttar Pradesh", cities: ["Lucknow", "Kanpur", "Ghaziabad", "Agra", "Varanasi", "Meerut", "Prayagraj", "Noida", "Bareilly", "Aligarh", "Moradabad", "Gorakhpur"] },
  { name: "Uttarakhand", cities: ["Dehradun", "Haridwar", "Roorkee", "Haldwani", "Rudrapur", "Kashipur", "Rishikesh", "Nainital"] },
  { name: "West Bengal", cities: ["Kolkata", "Howrah", "Durgapur", "Asansol", "Siliguri", "Bardhaman", "Malda", "Kharagpur", "Haldia"] },
  { name: "Andaman and Nicobar Islands", cities: ["Port Blair", "Diglipur", "Rangat", "Mayabunder"] },
  { name: "Chandigarh", cities: ["Chandigarh"] },
  { name: "Dadra and Nagar Haveli and Daman and Diu", cities: ["Daman", "Silvassa", "Diu"] },
  { name: "Delhi", cities: ["New Delhi", "Delhi", "Dwarka", "Rohini", "Saket", "Pitampura", "Karol Bagh"] },
  { name: "Jammu and Kashmir", cities: ["Srinagar", "Jammu", "Anantnag", "Baramulla", "Udhampur", "Kathua", "Sopore"] },
  { name: "Ladakh", cities: ["Leh", "Kargil"] },
  { name: "Lakshadweep", cities: ["Kavaratti", "Agatti", "Amini", "Minicoy"] },
  { name: "Puducherry", cities: ["Puducherry", "Karaikal", "Yanam", "Mahe"] },
]

export const STATE_NAMES: string[] = INDIA_STATES.map((s) => s.name)

/** Cities for the given state name (empty when the state is unknown/blank). */
export function citiesForState(state: string): string[] {
  return INDIA_STATES.find((s) => s.name === state)?.cities ?? []
}
