const formatter=(options:Intl.DateTimeFormatOptions,timeZone?:string)=>new Intl.DateTimeFormat('en-US',{...options,...(timeZone?{timeZone}:{})});
export const formatTaskWindow=(start:string,end:string,timeZone?:string)=>`${formatClockTime(start,timeZone)} - ${formatClockTime(end,timeZone)}`;
export const formatClockTime=(value:string|Date,timeZone?:string)=>formatter({hour:'numeric',minute:'2-digit'},timeZone).format(new Date(value));
export const formatShortDate=(value:string,timeZone?:string)=>formatter({day:'numeric',month:'short'},timeZone).format(new Date(value));
export const formatShortDateTime=(value:string|Date,timeZone?:string)=>formatter({day:'numeric',month:'short',hour:'numeric',minute:'2-digit'},timeZone).format(new Date(value));
export const formatAttendanceStatus=(status:string)=>status.replaceAll('_',' ').toLowerCase().replace(/(^|\s)\S/g,char=>char.toUpperCase());
