import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { AppState, Share, View, ScrollView } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { spatialTracking, SpatialCamera, type SpatialCapability } from '../../../modules/spatial-tracking';
import type { SpatialSample } from '../../verification/spatialTypes';
import { Button } from '../../components/ui/button';
import { Text } from '../../components/ui/text';
const distance=(a:SpatialSample['camera'],b:SpatialSample['camera'])=>a&&b?Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y,a.position.z-b.position.z):null;
export function SpatialDiagnosticScreen(){
 const [permission,request]=useCameraPermissions();
 const [capability,setCapability]=useState<SpatialCapability>('NO_SPATIAL');
 const [worldId,setWorldId]=useState('');
 const [running,setRunning]=useState(false);const [message,setMessage]=useState('');
 const [samples,setSamples]=useState<SpatialSample[]>([]);const [truth,setTruth]=useState<'SAME'|'DIFFERENT'|'UNKNOWN'>('UNKNOWN');
 useEffect(()=>{let live=true;void spatialTracking.isSupported().then(value=>{if(live)setCapability(value);}).catch(()=>{if(live)setCapability('NO_SPATIAL');});const sub=AppState.addEventListener('change',state=>{if(state!=='active'){void spatialTracking.interrupt().catch(()=>{});setRunning(false);setMessage('Interrupted: start a new world. A/B comparison cleared on restart.');}});return()=>{live=false;sub.remove();void spatialTracking.stop().catch(()=>{});};},[]);
 if(!__DEV__)return null;
 async function start(){try{if(!(permission?.granted||(await request()).granted))return;await spatialTracking.stop();await spatialTracking.start();setWorldId(Crypto.randomUUID());setSamples([]);setTruth('UNKNOWN');setRunning(true);}catch(e){setMessage(String(e));}}
 async function capture(){try{const result=await spatialTracking.captureSpatialObservation();try{setSamples(old=>[...old,result.sample].slice(-2));}finally{const file=new File(result.uri);if(file.exists)file.delete();}}catch(e){setMessage(String(e));}}
 const [a,b]=samples;
 const worldDistance=a?.worldPoint&&b?.worldPoint&&a.continuity==='CONTINUOUS'&&b.continuity==='CONTINUOUS'?distance({position:a.worldPoint.position,orientation:{x:0,y:0,z:0,w:1}},{position:b.worldPoint.position,orientation:{x:0,y:0,z:0,w:1}}):null;
 return <ScrollView contentContainerStyle={{padding:20,gap:16}}>
   <Text className="text-xl font-bold">Spatial diagnostic · development only</Text><Text>{capability}</Text><Text>{message}</Text>
   <Button onPress={()=>void start()}>Start spatial tracking (new world)</Button>
   {running?<><View style={{height:340}}><SpatialCamera style={{flex:1}}/><View pointerEvents="none" style={{position:'absolute',left:'45%',top:'45%',width:'10%',height:'10%',borderWidth:2,borderColor:'white'}}/></View><Button onPress={()=>void capture()}>Capture Fixture {samples.length===0?'A':'B'}</Button></>:null}
   <Text selectable>{JSON.stringify(samples,null,2)}</Text>
   <Text>Camera displacement: {a&&b?String(distance(a.camera,b.camera)):'—'} m</Text>
   <Text>Reliable fixture point distance: {a?.worldPoint?.quality==='GOOD'&&b?.worldPoint?.quality==='GOOD'&&a.worldPoint.uncertaintyMeters!==null&&b.worldPoint.uncertaintyMeters!==null?String(worldDistance):'unavailable; points have not been calibrated'}</Text>
   <Text>Center point distance: {String(worldDistance)} m (candidate geometry; not fixture proof)</Text>
   {(['SAME','DIFFERENT','UNKNOWN'] as const).map(value=><Button key={value} variant="outline" onPress={()=>setTruth(value)}>Human ground truth: {value}{truth===value?' ✓':''}</Button>)}
   <Button variant="outline" onPress={()=>void Share.share({message:JSON.stringify({version:1,worldId,capability,fixtureSequence:samples.map((_,index)=>index===0?'A':'B'),samples,humanGroundTruth:truth,cameraDisplacementMeters:a&&b?distance(a.camera,b.camera):null,candidatePointDistanceMeters:worldDistance})})}>Export diagnostic metadata</Button>
   <Button onPress={()=>{void spatialTracking.stop().catch(error=>setMessage(String(error)));setRunning(false);}}>Stop</Button>
 </ScrollView>;
}
