-- Pruebas de las reglas del CRM (M4 + M5). SOLO para un Postgres LOCAL de pruebas:
-- crea un esquema tst y datos ficticios. Nunca ejecutar en Supabase.
-- Cada fila: regla, caso, resultado esperado y obtenido. Debe terminar con FALLOS 0.
\set QUIET 1
create schema tst; grant usage, create on schema tst to service_role;
create table tst.r(n serial, regla text, caso text, esperado text, obtenido text, ok boolean);
create table tst.v(k text primary key, v uuid);
grant all on tst.r, tst.v to service_role; grant usage on sequence tst.r_n_seq to service_role;
create function tst.id(text) returns uuid language sql as $$ select v from tst.v where k=$1 $$;
create function tst.t(regla text, caso text, q text, esperado text) returns void language plpgsql as $$
declare got text := 'ok';
begin
  begin execute q; exception when others then got := sqlstate || ' ' || sqlerrm; end;
  insert into tst.r(regla,caso,esperado,obtenido,ok) values (regla,caso,esperado,got,
    case when esperado='ok' then got='ok' else got like '%'||esperado||'%' end);
end $$;
\o /dev/null
grant insert on tst.r to authenticated, anon; grant usage on schema tst to authenticated, anon; grant usage on sequence tst.r_n_seq to authenticated, anon; grant select on tst.v to authenticated, anon;
set role service_role;
-- ── datos base
insert into tst.v select 'u'||g, gen_random_uuid() from generate_series(1,6) g;
insert into auth.users(id) select v from tst.v where k like 'u%';
insert into tst.v values ('area1',(select id from public.areas_practica where numero=1)),('area5',(select id from public.areas_practica where numero=5)),
 ('srv1',(select s.id from public.servicios s join public.areas_practica a on a.id=s.area_id where a.numero=1 and s.numero=1)),
 ('srv5',(select s.id from public.servicios s join public.areas_practica a on a.id=s.area_id where a.numero=5 and s.numero=1));
with i as (insert into public.crm_personal(rol,nombres,apellidos,es_abogado,matricula,habilitacion_verificada) values ('direccion','Dir','Uno',true,'M1',true) returning id) insert into tst.v select 'dir',id from i;
with i as (insert into public.crm_personal(rol,nombres,apellidos) values ('coordinacion','Coord','Uno') returning id) insert into tst.v select 'coord',id from i;
with i as (insert into public.crm_personal(rol,nombres,apellidos) values ('asistencia','Asis','Uno') returning id) insert into tst.v select 'asis',id from i;
with i as (insert into public.crm_personal(user_id,rol,nombres,apellidos,es_abogado,matricula,habilitacion_verificada,capacidad_maxima) values (tst.id('u4'),'asociado','Abo','Uno',true,'M2',true,1) returning id) insert into tst.v select 'abo1',id from i;
with i as (insert into public.crm_personal(rol,nombres,apellidos,es_abogado,matricula,habilitacion_verificada) values ('asociado','Abo','Dos',true,'M3',true) returning id) insert into tst.v select 'abo2',id from i;
with i as (insert into public.crm_personal(rol,nombres,apellidos,es_abogado) values ('asociado','Abo','SinVerificar',true) returning id) insert into tst.v select 'abo3',id from i;
with i as (insert into public.crm_personal(rol,nombres,apellidos) values ('externo','Perito','Uno') returning id) insert into tst.v select 'ext',id from i;

-- ── PERSONAL
select tst.t('R-55','desactivar última Dirección', $$update public.crm_personal set activo=false where id=tst.id('dir')$$,'CRM-R55');
select tst.t('R-55','degradar última Dirección', $$update public.crm_personal set rol='coordinacion' where id=tst.id('dir')$$,'CRM-R55');
select tst.t('personal','asociado que no es abogado', $$insert into public.crm_personal(rol,nombres,apellidos) values('asociado','x','y')$$,'crm_personal_asociado_check');
select tst.t('personal','habilitación verificada sin matrícula', $$insert into public.crm_personal(rol,nombres,apellidos,es_abogado,habilitacion_verificada) values('asociado','x','y',true,true)$$,'crm_personal_habilitacion_check');
select tst.t('personal','rol inexistente', $$insert into public.crm_personal(rol,nombres,apellidos) values('jefe','x','y')$$,'crm_personal_rol_check');
select tst.t('R-28','titular de área válido', $$insert into public.crm_personal_areas values(tst.id('abo1'),tst.id('area1'),'titular')$$,'ok');
select tst.t('R-28','segundo titular en la misma área', $$insert into public.crm_personal_areas values(tst.id('abo2'),tst.id('area1'),'titular')$$,'crm_personal_areas_un_titular');
select tst.t('R-28','asistencia como referencia de área', $$insert into public.crm_personal_areas values(tst.id('asis'),tst.id('area5'),'miembro')$$,'CRM-R28');
-- ── AGENDA
select tst.t('R-32','horario lun 9-13', $$insert into public.crm_horarios(personal_id,dia_semana,hora_inicio,hora_fin) values(tst.id('abo1'),1,'09:00','13:00')$$,'ok');
select tst.t('R-32','franja contigua 13-17', $$insert into public.crm_horarios(personal_id,dia_semana,hora_inicio,hora_fin) values(tst.id('abo1'),1,'13:00','17:00')$$,'ok');
select tst.t('R-32','franja solapada 12-14', $$insert into public.crm_horarios(personal_id,dia_semana,hora_inicio,hora_fin) values(tst.id('abo1'),1,'12:00','14:00')$$,'crm_horarios_sin_solape');
select tst.t('R-36','horario fin antes de inicio', $$insert into public.crm_horarios(personal_id,dia_semana,hora_inicio,hora_fin) values(tst.id('abo1'),2,'10:00','09:00')$$,'crm_horarios_rango_check');
select tst.t('R-36','bloqueo invertido', $$insert into public.crm_bloqueos(personal_id,desde,hasta) values(tst.id('abo1'),now(),now()-interval '1 h')$$,'crm_bloqueos_rango_check');
-- ── CONTACTOS
select tst.t('R-01','persona sin nombres', $$insert into public.crm_contactos(tipo) values('persona')$$,'crm_contactos_datos_minimos_check');
select tst.t('R-01','empresa sin razón social', $$insert into public.crm_contactos(tipo,nombres) values('empresa','x')$$,'crm_contactos_datos_minimos_check');
with i as (insert into public.crm_contactos(nombres,apellidos,tipo_identificacion,identificacion,correo,telefono_normalizado) values('Ana','Paz','cedula','0912345678','  Ana@Mail.COM ','+593991234567') returning id) insert into tst.v select 'c1',id from i;
with i as (insert into public.crm_contactos(nombres,apellidos,correo) values('Ana','Paz B','ana@mail.com') returning id) insert into tst.v select 'c2',id from i;
with i as (insert into public.crm_contactos(tipo,razon_social,tipo_identificacion,identificacion) values('empresa','ACME S.A.','ruc','0991234567001') returning id) insert into tst.v select 'e1',id from i;
with i as (insert into public.crm_contactos(nombres) values('Luis') returning id) insert into tst.v select 'c3',id from i;
select tst.t('R-03','correo normalizado automático', $q$do $x$ begin if (select correo_normalizado from public.crm_contactos where id=tst.id('c1'))<>'ana@mail.com' then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-02','cédula repetida', $$insert into public.crm_contactos(nombres,tipo_identificacion,identificacion) values('Otro','cedula','0912345678')$$,'crm_contactos_identificacion_key');
select tst.t('R-03','cédula de 9 dígitos', $$insert into public.crm_contactos(nombres,tipo_identificacion,identificacion) values('Otro','cedula','091234567')$$,'crm_contactos_identificacion_formato_check');
select tst.t('R-03','identificación sin tipo', $$insert into public.crm_contactos(nombres,identificacion) values('Otro','0912345679')$$,'crm_contactos_identificacion_par_check');
select tst.t('R-03','empresa con cédula', $$insert into public.crm_contactos(tipo,razon_social,tipo_identificacion,identificacion) values('empresa','X','cedula','0912345670')$$,'crm_contactos_empresa_identificacion_check');
select tst.t('R-03','teléfono no E.164', $$insert into public.crm_contactos(nombres,telefono_normalizado) values('Otro','0991234567')$$,'crm_contactos_telefono_check');
select tst.t('R-04','correo repetido se permite', $q$do $x$ begin if (select count(*) from public.crm_contactos where correo_normalizado='ana@mail.com')<>2 then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-06','no continúa sin motivo', $$update public.crm_contactos set etapa_relacion='no_continua' where id=tst.id('c3')$$,'crm_contactos_motivo_no_continua_check');
select tst.t('R-07','vínculo empresa-persona', $$insert into public.crm_contacto_vinculos(empresa_id,persona_id,cargo,es_representante_legal) values(tst.id('e1'),tst.id('c1'),'Gerente',true)$$,'ok');
select tst.t('R-07','vínculo con persona como empresa', $$insert into public.crm_contacto_vinculos(empresa_id,persona_id) values(tst.id('c2'),tst.id('c1'))$$,'CRM-R07');
select tst.t('R-52','borrar contacto', $$delete from public.crm_contactos where id=tst.id('c3')$$,'permission denied');
-- ── SOLICITUDES
select tst.t('R-12','nacer en otro estado', $$insert into public.crm_solicitudes(contacto_id,canal_origen,descripcion,estado) values(tst.id('c1'),'web','x','en_curso')$$,'CRM-R12');
select tst.t('R-15','servicio de otra área', $$insert into public.crm_solicitudes(contacto_id,canal_origen,descripcion,area_principal_id,servicio_id) values(tst.id('c1'),'web','x',tst.id('area1'),tst.id('srv5'))$$,'CRM-R15');
select tst.t('R-15','servicio sin área', $$insert into public.crm_solicitudes(contacto_id,canal_origen,descripcion,servicio_id) values(tst.id('c1'),'web','x',tst.id('srv5'))$$,'CRM-R15');
select tst.t('R-07','empresa_id que es persona', $$insert into public.crm_solicitudes(contacto_id,empresa_id,canal_origen,descripcion) values(tst.id('c1'),tst.id('c2'),'web','x')$$,'CRM-R07');
with i as (insert into public.crm_solicitudes(contacto_id,empresa_id,canal_origen,descripcion,area_principal_id,servicio_id,origen_tabla,origen_id) values(tst.id('c1'),tst.id('e1'),'web','Cobro de deuda',tst.id('area1'),tst.id('srv1'),'consultas',tst.id('u1')) returning id) insert into tst.v select 's1',id from i;
with i as (insert into public.crm_solicitudes(contacto_id,canal_origen,descripcion,area_principal_id) values(tst.id('c2'),'llamada','Caso 2',tst.id('area5')) returning id) insert into tst.v select 's2',id from i;
with i as (insert into public.crm_solicitudes(contacto_id,canal_origen,descripcion) values(tst.id('c3'),'presencial','Caso 3') returning id) insert into tst.v select 's3',id from i;
with i as (insert into public.crm_solicitudes(contacto_id,canal_origen,descripcion) values(tst.id('c3'),'referido','Caso 4') returning id) insert into tst.v select 's4',id from i;
with i as (insert into public.crm_solicitudes(contacto_id,canal_origen,descripcion) values(tst.id('c3'),'cita','Caso 5') returning id) insert into tst.v select 's5',id from i;
select tst.t('R-10','código con formato S26-0001', $q$do $x$ begin if (select codigo from public.crm_solicitudes where id=tst.id('s1')) !~ '^S[0-9]{2}-[0-9]{4}$' then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-10','el código no se puede cambiar', $$update public.crm_solicitudes set codigo='S26-9999' where id=tst.id('s1')$$,'CRM-R10');
select tst.t('R-10','el código enviado a mano se ignora', $q$do $x$ declare c text; begin insert into public.crm_solicitudes(contacto_id,canal_origen,descripcion,codigo) values(tst.id('c3'),'web','x','MIO-1') returning codigo into c; if c !~ '^S[0-9]{2}-[0-9]{4}$' then raise exception 'quedó %', c; end if; end $x$ $q$,'ok');
reset role; select setval('public.crm_solicitud_codigo_seq', 12344); set role service_role;
select tst.t('R-10','pasado el 9999 el código crece, no se trunca', $q$do $x$ declare c text; begin insert into public.crm_solicitudes(contacto_id,canal_origen,descripcion) values(tst.id('c3'),'web','x') returning codigo into c; if c !~ '^S[0-9]{2}-12345$' then raise exception 'quedó %', c; end if; end $x$ $q$,'ok');
select tst.t('buscador','encuentra sin tildes ni mayúsculas', $q$do $x$ begin insert into public.crm_contactos(nombres,apellidos) values('José','Peña Ávila'); if (select count(*) from public.crm_contactos where busqueda like '%pena avila%')<>1 then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-11','misma consulta web dos veces', $$insert into public.crm_solicitudes(contacto_id,canal_origen,descripcion,origen_tabla,origen_id) values(tst.id('c1'),'web','x','consultas',tst.id('u1'))$$,'crm_solicitudes_origen_key');
select tst.t('R-12','saltar nueva → en_curso', $$update public.crm_solicitudes set estado='en_curso' where id=tst.id('s1')$$,'CRM-R12');
select tst.t('R-13','descartar sin motivo', $$update public.crm_solicitudes set estado='descartada' where id=tst.id('s3')$$,'CRM-R13');
select tst.t('R-13','descartar con motivo', $$update public.crm_solicitudes set estado='descartada', motivo_estado='Sin respuesta' where id=tst.id('s3')$$,'ok');
select tst.t('R-13','reabrir descartada con el motivo viejo', $$update public.crm_solicitudes set estado='en_calificacion' where id=tst.id('s3')$$,'CRM-R13');
select tst.t('R-13','reabrir descartada con motivo nuevo', $$update public.crm_solicitudes set estado='en_calificacion', motivo_estado='El cliente volvió' where id=tst.id('s3')$$,'ok');
select tst.t('R-12','recorrido nueva → pendiente de aceptación', $q$do $x$ declare e text; begin foreach e in array array['en_calificacion','propuesta_enviada','pendiente_aceptacion'] loop update public.crm_solicitudes set estado=e where id in (tst.id('s1'),tst.id('s2'),tst.id('s4')); end loop; end $x$ $q$,'ok');
-- ── CONFLICTOS Y EQUIPO
select tst.t('R-20','aceptar el encargo sin revisión de conflictos', $$update public.crm_solicitudes set estado='aceptada_pendiente_asignacion' where id=tst.id('s1')$$,'crm_solicitudes_conflicto_asignacion_check');
select tst.t('R-20','revisión sin revisor', $$update public.crm_solicitudes set conflicto_revision='sin_conflicto' where id=tst.id('s1')$$,'crm_solicitudes_conflicto_revisor_check');
select tst.t('R-21','registrar conflicto', $$update public.crm_solicitudes set conflicto_revision='con_conflicto', conflicto_revisado_por=tst.id('u1'), conflicto_detalle='Contraparte es cliente' where id=tst.id('s4')$$,'ok');
select tst.t('R-21','aceptar un encargo con conflicto', $$update public.crm_solicitudes set estado='aceptada_pendiente_asignacion' where id=tst.id('s4')$$,'crm_solicitudes_conflicto_asignacion_check');
select tst.t('R-21','con conflicto solo cabe descartar', $$update public.crm_solicitudes set estado='descartada', motivo_estado='Conflicto de interés' where id=tst.id('s4')$$,'ok');
update public.crm_solicitudes set conflicto_revision='sin_conflicto', conflicto_revisado_por=tst.id('u1') where id in (tst.id('s1'),tst.id('s2'));
update public.crm_solicitudes set estado='aceptada_pendiente_asignacion' where id in (tst.id('s1'),tst.id('s2'));
select tst.t('R-22','equipo en caso no aceptado', $$insert into public.crm_solicitud_equipo(solicitud_id,personal_id,rol,propuesto_por) values(tst.id('s3'),tst.id('abo1'),'titular',tst.id('u1'))$$,'CRM-R22');
select tst.t('R-24','titular sin habilitación verificada', $$insert into public.crm_solicitud_equipo(solicitud_id,personal_id,rol,propuesto_por) values(tst.id('s1'),tst.id('abo3'),'titular',tst.id('u1'))$$,'CRM-R24');
select tst.t('R-24','asistencia como titular', $$insert into public.crm_solicitud_equipo(solicitud_id,personal_id,rol,propuesto_por) values(tst.id('s1'),tst.id('asis'),'titular',tst.id('u1'))$$,'CRM-R24');
select tst.t('R-24','externo sin acuerdo de confidencialidad', $$insert into public.crm_solicitud_equipo(solicitud_id,personal_id,rol,propuesto_por) values(tst.id('s1'),tst.id('ext'),'perito',tst.id('u1'))$$,'CRM-R24');
select tst.t('R-22','pasar a asignada sin titular', $$update public.crm_solicitudes set estado='asignada' where id=tst.id('s1')$$,'CRM-R22');
with i as (insert into public.crm_solicitud_equipo(solicitud_id,personal_id,rol,propuesto_por) values(tst.id('s1'),tst.id('abo1'),'titular',tst.id('u2')) returning id) insert into tst.v select 'eq1',id from i;
select tst.t('R-23','segundo titular en el caso', $$insert into public.crm_solicitud_equipo(solicitud_id,personal_id,rol,propuesto_por) values(tst.id('s1'),tst.id('abo2'),'titular',tst.id('u1'))$$,'crm_solicitud_equipo_un_titular');
select tst.t('R-23','misma persona dos veces', $$insert into public.crm_solicitud_equipo(solicitud_id,personal_id,rol,propuesto_por) values(tst.id('s1'),tst.id('abo1'),'apoyo',tst.id('u1'))$$,'crm_solicitud_equipo_miembro_vigente');
select tst.t('R-22','asignada con titular solo propuesto', $$update public.crm_solicitudes set estado='asignada' where id=tst.id('s1')$$,'CRM-R22');
select tst.t('R-22','aprobar sin registrar quién aprueba', $$update public.crm_solicitud_equipo set estado='pendiente_confirmacion' where id=tst.id('eq1')$$,'crm_solicitud_equipo_aprobacion_check');
select tst.t('R-22','aprobar deja el caso en asignada', $q$do $x$ begin perform public.crm_aprobar_asignacion(tst.id('eq1'),tst.id('u1')); if (select estado from public.crm_solicitudes where id=tst.id('s1'))<>'asignada' or (select estado from public.crm_solicitud_equipo where id=tst.id('eq1'))<>'pendiente_confirmacion' then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-22','aprobar dos veces', $$select public.crm_aprobar_asignacion(tst.id('eq1'),tst.id('u1'))$$,'CRM-R22');
select tst.t('R-23','en curso sin confirmación del abogado', $$update public.crm_solicitudes set estado='en_curso' where id=tst.id('s1')$$,'CRM-R23');
select tst.t('R-22','confirma otra persona', $$select public.crm_responder_asignacion(tst.id('eq1'),tst.id('u5'),true)$$,'CRM-R22');
select tst.t('R-22','confirma el abogado y pasa a en curso', $q$do $x$ begin perform public.crm_responder_asignacion(tst.id('eq1'),tst.id('u4'),true); if (select estado from public.crm_solicitudes where id=tst.id('s1'))<>'en_curso' then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-22','suplente en reserva', $$insert into public.crm_solicitud_equipo(solicitud_id,personal_id,rol,estado,propuesto_por,aprobado_por,aprobado_at) values(tst.id('s1'),tst.id('abo2'),'suplente','en_reserva',tst.id('u1'),tst.id('u1'),now())$$,'ok');
-- capacidad: abo1 tiene límite 1 y ya lleva s1
with i as (insert into public.crm_solicitud_equipo(solicitud_id,personal_id,rol,propuesto_por) values(tst.id('s2'),tst.id('abo1'),'titular',tst.id('u2')) returning id) insert into tst.v select 'eq2',id from i;
select tst.t('R-26','aprobar sobre el límite sin autorización', $$select public.crm_aprobar_asignacion(tst.id('eq2'),tst.id('u1'))$$,'CRM-R26');
select tst.t('R-26','tras el rechazo nada cambió', $q$do $x$ begin if (select estado from public.crm_solicitud_equipo where id=tst.id('eq2'))<>'propuesto' or (select estado from public.crm_solicitudes where id=tst.id('s2'))<>'aceptada_pendiente_asignacion' then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-26','autorizar sin motivo', $$select public.crm_aprobar_asignacion(tst.id('eq2'),tst.id('u1'),true)$$,'crm_solicitud_equipo_capacidad_check');
select tst.t('R-26','autorizar con motivo', $$select public.crm_aprobar_asignacion(tst.id('eq2'),tst.id('u1'),true,'Único especialista')$$,'ok');
select tst.t('R-13','abogado rechaza sin motivo', $$select public.crm_responder_asignacion(tst.id('eq2'),tst.id('u4'),false)$$,'CRM-R13');
select tst.t('R-22','abogado rechaza y el caso vuelve a pendiente de asignación', $q$do $x$ begin perform public.crm_responder_asignacion(tst.id('eq2'),tst.id('u4'),false,'Impedimento'); if (select estado from public.crm_solicitudes where id=tst.id('s2'))<>'aceptada_pendiente_asignacion' then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-26','un caso en espera sigue contando en la carga', $q$do $x$ begin update public.crm_solicitudes set estado='en_espera', motivo_estado='Pausa de prueba' where id=tst.id('s1'); if public.crm_carga_titular(tst.id('abo1'))<>1 then raise exception 'mal'; end if; update public.crm_solicitudes set estado='en_curso' where id=tst.id('s1'); end $x$ $q$,'ok');
select tst.t('R-26','vista de carga = 1', $q$do $x$ begin if (select carga_titular from public.crm_v_carga_personal where personal_id=tst.id('abo1'))<>1 then raise exception 'mal'; end if; end $x$ $q$,'ok');
-- ── ACTIVIDADES
select tst.t('R-40','tarea sin responsable', $$insert into public.crm_actividades(contacto_id,solicitud_id,tipo,descripcion,vence_at,estado_tarea) values(tst.id('c1'),tst.id('s1'),'tarea','x',now(),'pendiente')$$,'crm_actividades_tarea_check');
select tst.t('R-40','tarea sin vencimiento', $$insert into public.crm_actividades(contacto_id,solicitud_id,tipo,descripcion,responsable_id,estado_tarea) values(tst.id('c1'),tst.id('s1'),'tarea','x',tst.id('abo1'),'pendiente')$$,'crm_actividades_tarea_check');
with i as (insert into public.crm_actividades(contacto_id,solicitud_id,tipo,descripcion,responsable_id,vence_at,estado_tarea,es_plazo_juridico) values(tst.id('c1'),tst.id('s1'),'tarea','Contestar demanda',tst.id('abo1'),now()+interval '5 d','pendiente',true) returning id) insert into tst.v select 't1',id from i;
select tst.t('R-41','plazo verificado por quien no es titular', $$update public.crm_actividades set plazo_verificado_por=tst.id('abo2') where id=tst.id('t1')$$,'CRM-R41');
select tst.t('R-41','plazo verificado por el titular', $$update public.crm_actividades set plazo_verificado_por=tst.id('abo1') where id=tst.id('t1')$$,'ok');
select tst.t('R-41','plazo verificado por Dirección', $$update public.crm_actividades set plazo_verificado_por=tst.id('dir') where id=tst.id('t1')$$,'ok');
select tst.t('R-14','cerrar sin resultado', $$update public.crm_solicitudes set estado='cerrada', motivo_estado='Fin' where id=tst.id('s1')$$,'CRM-R14');
select tst.t('R-14','cerrar con tareas abiertas', $$update public.crm_solicitudes set estado='cerrada', motivo_estado='Fin', resultado_cierre='Acuerdo de pago' where id=tst.id('s1')$$,'CRM-R14');
select tst.t('R-40','completar tarea pone fecha', $q$do $x$ begin update public.crm_actividades set estado_tarea='hecha' where id=tst.id('t1'); if (select completada_at from public.crm_actividades where id=tst.id('t1')) is null then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-52','borrar actividad', $$delete from public.crm_actividades where id=tst.id('t1')$$,'permission denied');
-- ── REASIGNACIÓN (activar suplente)
select tst.t('R-27','reasignar a persona sin habilitación', $$select public.crm_reasignar_titular(tst.id('s1'),tst.id('abo3'),'ausencia',tst.id('u1'))$$,'CRM-R24');
select tst.t('R-27','tras el fallo el titular sigue intacto', $q$do $x$ begin if not exists(select 1 from public.crm_solicitud_equipo where id=tst.id('eq1') and estado='activo') then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-27','activar al suplente', $$select public.crm_reasignar_titular(tst.id('s1'),tst.id('abo2'),'ausencia',tst.id('u1'),'Titular con licencia',true)$$,'ok');
select tst.t('R-27','queda un solo titular activo y registro', $q$do $x$ begin if (select count(*) from public.crm_solicitud_equipo where solicitud_id=tst.id('s1') and rol='titular' and estado='activo' and personal_id=tst.id('abo2'))<>1 or (select count(*) from public.crm_solicitud_equipo where solicitud_id=tst.id('s1') and estado in ('activo','en_reserva','propuesto','pendiente_confirmacion'))<>1 or (select count(*) from public.crm_reasignaciones where solicitud_id=tst.id('s1'))<>1 then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-50','modificar una reasignación', $$update public.crm_reasignaciones set motivo='otro'$$,'permission denied');
-- ── CIERRE / REAPERTURA
select tst.t('R-12','en espera con motivo', $$update public.crm_solicitudes set estado='en_espera', motivo_estado='Esperando peritaje' where id=tst.id('s1')$$,'ok');
select tst.t('R-12','volver a en curso limpia el motivo', $q$do $x$ begin update public.crm_solicitudes set estado='en_curso' where id=tst.id('s1'); if (select motivo_estado from public.crm_solicitudes where id=tst.id('s1')) is not null then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-14','cerrar correctamente', $$update public.crm_solicitudes set estado='cerrada', motivo_estado='Concluido', resultado_cierre='Acuerdo de pago', estado_por=tst.id('u1') where id=tst.id('s1')$$,'ok');
select tst.t('R-12','cerrada → en espera', $$update public.crm_solicitudes set estado='en_espera', motivo_estado='x' where id=tst.id('s1')$$,'CRM-R12');
select tst.t('R-13','reabrir con motivo', $q$do $x$ begin update public.crm_solicitudes set estado='en_curso', motivo_estado='Apelación' where id=tst.id('s1'); if (select cerrada_at from public.crm_solicitudes where id=tst.id('s1')) is not null then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-51','historial de estados completo (13 filas de s1)', $q$do $x$ begin if (select count(*) from public.crm_solicitud_estados where solicitud_id=tst.id('s1'))<>13 then raise exception 'hay %', (select count(*) from public.crm_solicitud_estados where solicitud_id=tst.id('s1')); end if; end $x$ $q$,'ok');
select tst.t('R-50','editar historial de estados', $$update public.crm_solicitud_estados set motivo='x'$$,'permission denied');
select tst.t('R-15','desactivar área no rompe casos existentes', $q$do $x$ begin update public.areas_practica set activo=false where numero=1; update public.crm_solicitudes set objetivo_cliente='x' where id=tst.id('s1'); end $x$ $q$,'ok');
select tst.t('R-15','área inactiva no se ofrece a casos nuevos', $$insert into public.crm_solicitudes(contacto_id,canal_origen,descripcion,area_principal_id) values(tst.id('c1'),'web','x',tst.id('area1'))$$,'CRM-R15');
-- ── FUSIÓN
select tst.t('R-05','fusionar persona con empresa', $$select public.crm_fusionar_contactos(tst.id('c1'),tst.id('e1'),tst.id('u1'))$$,'CRM-R05');
insert into public.crm_posibles_duplicados(contacto_a,contacto_b,coincidencia) select least(tst.id('c1'),tst.id('c2')), greatest(tst.id('c1'),tst.id('c2')),'correo';
select tst.t('R-05','fusionar c2 dentro de c1', $$select public.crm_fusionar_contactos(tst.id('c1'),tst.id('c2'),tst.id('u1'),'Misma persona')$$,'ok');
select tst.t('R-05','resultado de la fusión', $q$do $x$ begin if (select contacto_id from public.crm_solicitudes where id=tst.id('s2'))<>tst.id('c1') or (select fusionado_en from public.crm_contactos where id=tst.id('c2'))<>tst.id('c1') or (select estado from public.crm_posibles_duplicados limit 1)<>'fusionado' or not exists(select 1 from public.crm_bitacora where accion='fusionar') then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-05','solicitud nueva en ficha fusionada', $$insert into public.crm_solicitudes(contacto_id,canal_origen,descripcion) values(tst.id('c2'),'web','x')$$,'CRM-R05');
select tst.t('R-05','fusionar una ficha ya fusionada', $$select public.crm_fusionar_contactos(tst.id('c3'),tst.id('c2'),tst.id('u1'))$$,'CRM-R05');
-- ── NOTIFICACIONES Y BITÁCORA
select tst.t('R-44','aviso fallido sin error registrado', $$insert into public.crm_notificaciones(contacto_id,canal,tipo,titulo,estado) values(tst.id('c1'),'correo','cita','x','fallida')$$,'crm_notificaciones_resultado_check');
select tst.t('R-44','aviso sin destinatario', $$insert into public.crm_notificaciones(canal,tipo,titulo) values('correo','cita','x')$$,'crm_notificaciones_un_destino_check');
select tst.t('R-50','insertar en bitácora', $$insert into public.crm_bitacora(accion,entidad) values('exportar','crm_solicitudes')$$,'ok');
select tst.t('R-50','editar bitácora', $$update public.crm_bitacora set accion='crear'$$,'permission denied');
select tst.t('R-50','borrar bitácora', $$delete from public.crm_bitacora$$,'permission denied');
-- ── CITAS (M5)
select tst.t('R-31','reserva web sin abogado', $$insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora) values('A','a@a.com','1','penal','2026-12-01','10:00')$$,'ok');
select tst.t('R-31','segunda reserva web misma hora', $$insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora) values('B','b@a.com','1','penal','2026-12-01','10:00')$$,'citas_un_turno_sin_abogado');
with i as (insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora,abogado_id,solicitud_id) values('C','c@a.com','1','civil','2026-12-01','10:00',tst.id('abo1'),tst.id('s1')) returning id) insert into tst.v select 'ci1',id from i;
select tst.t('R-30','mismo abogado 10:30 (cruza con 10:00-11:00)', $$insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora,abogado_id) values('D','d@a.com','1','civil','2026-12-01','10:30',tst.id('abo1'))$$,'citas_sin_cruce_abogado');
select tst.t('R-30','mismo abogado 09:30 de 60 min (cruza)', $$insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora,abogado_id) values('D','d@a.com','1','civil','2026-12-01','09:30',tst.id('abo1'))$$,'citas_sin_cruce_abogado');
select tst.t('R-30','mismo abogado 09:30 de 30 min (no cruza)', $$insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora,abogado_id,duracion_min) values('D','d@a.com','1','civil','2026-12-01','09:30',tst.id('abo1'),30)$$,'ok');
select tst.t('R-30','mismo abogado 11:00 (contigua)', $$insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora,abogado_id) values('E','e@a.com','1','civil','2026-12-01','11:00',tst.id('abo1'))$$,'ok');
select tst.t('R-30','otro abogado a la misma hora', $$insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora,abogado_id) values('F','f@a.com','1','civil','2026-12-01','10:00',tst.id('abo2'))$$,'ok');
select tst.t('R-30','asignar la reserva web a un abogado ocupado', $$update public.citas set abogado_id=tst.id('abo1') where nombre='A'$$,'citas_sin_cruce_abogado');
select tst.t('R-32','cita con alguien que no es abogado', $$insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora,abogado_id) values('G','g@a.com','1','civil','2026-12-02','10:00',tst.id('asis'))$$,'CRM-R32');
select tst.t('R-34','duración de 5 minutos', $$insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora,duracion_min) values('G','g@a.com','1','civil','2026-12-02','10:00',5)$$,'citas_duracion_check');
select tst.t('R-36','cita que cruza la medianoche', $$insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora,duracion_min) values('G','g@a.com','1','civil','2026-12-02','23:30',60)$$,'citas_fin_mismo_dia_check');
select tst.t('R-37','motivo de cancelación en cita activa', $$update public.citas set motivo_cancelacion='x' where id=tst.id('ci1')$$,'citas_cancelacion_check');
select tst.t('R-37','cancelar sin motivo', $$select public.crm_cancelar_cita(tst.id('ci1'),'cliente','')$$,'CRM-R37');
select tst.t('R-37','cancelar registra fecha, motivo y bitácora', $q$do $x$ begin perform public.crm_cancelar_cita(tst.id('ci1'),'cliente','Cliente viajó',tst.id('u3')); if (select cancelada_at from public.citas where id=tst.id('ci1')) is null or not exists(select 1 from public.crm_bitacora where accion='cancelar_cita') then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-37','cancelar una cita ya cancelada', $$select public.crm_cancelar_cita(tst.id('ci1'),'cliente','Otra vez')$$,'CRM-R37');
update public.crm_solicitudes set estado='en_calificacion' where id=tst.id('s5'); update public.crm_solicitudes set estado='consulta_agendada' where id=tst.id('s5');
with i as (insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora,abogado_id,solicitud_id) values('S5','s@a.com','1','civil','2027-01-15','15:00',tst.id('abo2'),tst.id('s5')) returning id) insert into tst.v select 'ci5',id from i;
select tst.t('R-18','descartar un caso con cita futura activa', $$update public.crm_solicitudes set estado='descartada', motivo_estado='No responde' where id=tst.id('s5')$$,'CRM-R18');
select tst.t('R-37','cancelar devuelve el caso a calificación y crea la tarea', $q$do $x$ begin perform public.crm_cancelar_cita(tst.id('ci5'),'estudio','Abogado en audiencia',tst.id('u3'),tst.id('asis')); if (select estado from public.crm_solicitudes where id=tst.id('s5'))<>'en_calificacion' or not exists(select 1 from public.crm_actividades where solicitud_id=tst.id('s5') and estado_tarea='pendiente' and responsable_id=tst.id('asis')) then raise exception 'mal'; end if; end $x$ $q$,'ok');
select tst.t('R-18','sin citas activas ya se puede descartar', $$update public.crm_solicitudes set estado='descartada', motivo_estado='No responde' where id=tst.id('s5')$$,'ok');
select tst.t('R-35','la hora cancelada queda libre', $$insert into public.citas(nombre,correo,telefono,tipo_consulta,fecha,hora,abogado_id,reagendada_de) values('H','h@a.com','1','civil','2026-12-01','10:00',tst.id('abo1'),tst.id('ci1'))$$,'ok');
select tst.t('R-38','reactivar una cita cancelada', $$update public.citas set estado='confirmada' where id=tst.id('ci1')$$,'CRM-R38');
select tst.t('R-39','marcar atendida y no asistió', $q$do $x$ begin update public.citas set estado='atendida' where nombre='H'; update public.citas set estado='no_asistio' where nombre='E'; end $x$ $q$,'ok');
select tst.t('R-38','cita atendida no vuelve a pendiente', $$update public.citas set estado='pendiente' where nombre='H'$$,'CRM-R38');
-- ── PERMISOS
reset role; set role authenticated;
select tst.t('seguridad','authenticated lee contactos', $$select 1 from public.crm_contactos$$,'permission denied');
select tst.t('seguridad','authenticated lee bitácora', $$select 1 from public.crm_bitacora$$,'permission denied');
select tst.t('seguridad','authenticated ejecuta fusión', $$select public.crm_fusionar_contactos(gen_random_uuid(),gen_random_uuid(),null)$$,'permission denied');
reset role; set role anon;
select tst.t('seguridad','anon lee solicitudes', $$select 1 from public.crm_solicitudes$$,'permission denied');
select tst.t('seguridad','anon lee personal', $$select 1 from public.crm_personal$$,'permission denied');
reset role;
select tst.t('R-50','ni el superusuario edita la bitácora', $$update public.crm_bitacora set accion='crear'$$,'CRM-R50');
select tst.t('R-50','ni el superusuario la vacía', $$truncate public.crm_bitacora$$,'CRM-R50');
\o
\pset format unaligned
\pset tuples_only on
select 'TOTAL '||count(*)||' · OK '||count(*) filter (where ok)||' · FALLOS '||count(*) filter (where not ok) from tst.r;
select n||' ['||regla||'] '||caso||E'\n     esperado: '||esperado||E'\n     obtenido: '||obtenido from tst.r where not ok order by n;
