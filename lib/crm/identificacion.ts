// Validación de documentos de identidad (sección 6 de la especificación).
//   · Cédula: 10 dígitos, provincia 01–24 o 30, tercer dígito < 6, dígito verificador módulo 10.
//     Si falla → se rechaza (400).
//   · RUC: 13 dígitos, provincia válida, termina en 001 o superior (estos tres controles rechazan).
//     Si SOLO el dígito verificador no cuadra, el RUC SE ACEPTA con `validada = false`
//     y la ficha muestra «no validado».
//   · Pasaporte / extranjera: 4 a 20 caracteres [A-Z0-9-], en mayúsculas.

export const TIPOS_IDENTIFICACION = ['cedula', 'pasaporte', 'ruc', 'extranjera'] as const
export type TipoIdentificacion = (typeof TIPOS_IDENTIFICACION)[number]

export type ResultadoIdentificacion =
  | { ok: true; identificacion: string; validada: boolean }
  | { ok: false; mensaje: string }

function provinciaValida(dosDigitos: string): boolean {
  const n = Number(dosDigitos)
  return (n >= 1 && n <= 24) || n === 30
}

/** Dígito verificador módulo 10 de los 9 primeros dígitos (cédula y RUC de persona natural). */
function digitoModulo10(nueve: string): number {
  let total = 0
  for (let i = 0; i < 9; i++) {
    let valor = Number(nueve[i]) * (i % 2 === 0 ? 2 : 1)
    if (valor > 9) valor -= 9
    total += valor
  }
  return (10 - (total % 10)) % 10
}

/** Dígito verificador módulo 11 con los coeficientes dados (RUC de sociedades y del sector público). */
function digitoModulo11(digitos: string, coeficientes: readonly number[]): number {
  const total = coeficientes.reduce((acc, c, i) => acc + c * Number(digitos[i]), 0)
  const residuo = total % 11
  return residuo === 0 ? 0 : 11 - residuo
}

export function cedulaValida(cedula: string): boolean {
  if (!/^\d{10}$/.test(cedula)) return false
  if (!provinciaValida(cedula.slice(0, 2))) return false
  if (Number(cedula[2]) >= 6) return false
  return digitoModulo10(cedula.slice(0, 9)) === Number(cedula[9])
}

/** ¿Cuadra el dígito verificador del RUC? Un tercer dígito desconocido (7, 8) no se puede verificar. */
export function rucDigitoCuadra(ruc: string): boolean {
  const tercero = Number(ruc[2])
  if (tercero < 6) return digitoModulo10(ruc.slice(0, 9)) === Number(ruc[9])
  if (tercero === 6) return digitoModulo11(ruc.slice(0, 8), [3, 2, 7, 6, 5, 4, 3, 2]) === Number(ruc[8])
  if (tercero === 9) return digitoModulo11(ruc.slice(0, 9), [4, 3, 2, 7, 6, 5, 4, 3, 2]) === Number(ruc[9])
  return false
}

export function validarIdentificacion(tipo: TipoIdentificacion, bruto: string): ResultadoIdentificacion {
  const valor = bruto.trim()

  switch (tipo) {
    case 'cedula': {
      if (!/^\d{10}$/.test(valor)) return { ok: false, mensaje: 'La cédula debe tener 10 dígitos' }
      if (!provinciaValida(valor.slice(0, 2))) return { ok: false, mensaje: 'Cédula no válida: provincia incorrecta' }
      if (Number(valor[2]) >= 6) return { ok: false, mensaje: 'Cédula no válida' }
      if (!cedulaValida(valor)) return { ok: false, mensaje: 'Cédula no válida: el dígito verificador no cuadra' }
      return { ok: true, identificacion: valor, validada: true }
    }
    case 'ruc': {
      if (!/^\d{13}$/.test(valor)) return { ok: false, mensaje: 'El RUC debe tener 13 dígitos' }
      if (!provinciaValida(valor.slice(0, 2))) return { ok: false, mensaje: 'RUC no válido: provincia incorrecta' }
      if (Number(valor.slice(10)) < 1) return { ok: false, mensaje: 'El RUC debe terminar en 001 o superior' }
      // Solo el dígito verificador es "blando": no cuadra → se acepta como no validado.
      return { ok: true, identificacion: valor, validada: rucDigitoCuadra(valor) }
    }
    case 'pasaporte':
    case 'extranjera': {
      const mayusculas = valor.toUpperCase()
      if (!/^[A-Z0-9-]{4,20}$/.test(mayusculas)) {
        return { ok: false, mensaje: 'Entre 4 y 20 caracteres: letras, números o guion' }
      }
      // No hay dígito verificador que comprobar: el formato es el único control.
      return { ok: true, identificacion: mayusculas, validada: true }
    }
  }
}
