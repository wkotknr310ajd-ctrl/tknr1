Attribute VB_Name = "modImport"
Option Explicit

' 既存のExcelシフト表(部署ごとの元ファイル)から、指定した部署のシフト表シートへ
' 職員名・日々の勤務コードを読み込む。
'
' 使い方:
'   1. 取り込み先の部署を選ぶ
'   2. 元になるExcelファイルを選ぶ(あらかじめパスワード保護は解除しておく)
'   3. 元ファイルのシート名を入力する
'   4. 元ファイルの「スタッフの行」の開始行・終了行を入力する
'
' 日付(1〜31日)の列位置はシートの中から自動検出するが、スタッフの行範囲は
' 自動判定しない。実際の勤務表は集計行や別グループの表が同じシートの下の方に
' 続いていることが多く、機械的な自動判定では女子計等の集計行を職員として
' 誤って取り込んでしまう恐れがあるため、必ず人の目で範囲を指定してもらう。
' 同じシートに複数のスタッフ・ブロックがある場合は、このマクロを複数回実行して
' ブロックごとに取り込む。
Public Sub ImportShiftTable()
    Dim deptNames As Collection
    Set deptNames = DepartmentSheetNames()
    If deptNames.Count = 0 Then
        MsgBox "部署のシフト表シート(「シフト表_」で始まる名前のシート)が見つかりません。", vbCritical
        Exit Sub
    End If

    Dim deptList As String
    Dim i As Long
    i = 0
    Dim dn As Variant
    For Each dn In deptNames
        i = i + 1
        deptList = deptList & i & ": " & CStr(dn) & vbCrLf
    Next dn

    Dim choice As String
    choice = InputBox("取り込み先の部署を番号で選んでください。" & vbCrLf & vbCrLf & deptList, "取り込み先の選択")
    If choice = "" Then Exit Sub
    If Not IsNumeric(choice) Then
        MsgBox "番号を入力してください。", vbExclamation
        Exit Sub
    End If
    Dim choiceNum As Long
    choiceNum = CLng(choice)
    If choiceNum < 1 Or choiceNum > deptNames.Count Then
        MsgBox "存在しない番号です。", vbExclamation
        Exit Sub
    End If

    Dim destWs As Worksheet
    Set destWs = ThisWorkbook.Sheets(CStr(deptNames(choiceNum)))

    Dim filePath As Variant
    filePath = Application.GetOpenFilename( _
        FileFilter:="Excelブック,*.xlsx;*.xlsm;*.xls", _
        Title:="取り込み元のExcelファイルを選択してください")
    If filePath = False Then Exit Sub

    Dim srcWb As Workbook
    On Error Resume Next
    Set srcWb = Workbooks.Open(CStr(filePath), ReadOnly:=True)
    On Error GoTo 0
    If srcWb Is Nothing Then
        MsgBox "ファイルを開けませんでした。パスワード保護されている場合は、" & vbCrLf & _
               "事前にパスワードを解除して保存したファイルを指定してください。", vbCritical
        Exit Sub
    End If

    Dim sheetList As String
    Dim sh As Worksheet
    For Each sh In srcWb.Worksheets
        sheetList = sheetList & "・" & sh.Name & vbCrLf
    Next sh

    Dim srcSheetName As String
    srcSheetName = InputBox("取り込み元のシート名を、以下から1つ選んで正確に入力してください。" & vbCrLf & vbCrLf & sheetList, _
                            "取り込み元シートの選択")
    If srcSheetName = "" Then
        srcWb.Close SaveChanges:=False
        Exit Sub
    End If

    Dim srcWs As Worksheet
    On Error Resume Next
    Set srcWs = srcWb.Sheets(srcSheetName)
    On Error GoTo 0
    If srcWs Is Nothing Then
        MsgBox "そのシート名は見つかりませんでした。", vbCritical
        srcWb.Close SaveChanges:=False
        Exit Sub
    End If

    Dim headerRow As Long
    Dim firstDayCol As Long
    firstDayCol = DetectFirstDayColumn(srcWs, headerRow)
    If firstDayCol = 0 Then
        MsgBox "「1、2、3…」と31日分近く連続する日付の行が見つかりませんでした。" & vbCrLf & _
               "対応していないレイアウトの可能性があります。", vbCritical
        srcWb.Close SaveChanges:=False
        Exit Sub
    End If

    Dim nameCol As Long
    nameCol = firstDayCol - 1

    Dim startRowStr As String, endRowStr As String
    startRowStr = InputBox("「" & srcSheetName & "」シートで日付ヘッダーが " & headerRow & " 行目に見つかりました。" & vbCrLf & _
                            "職員の氏名が並んでいる最初の行番号を入力してください。", _
                            "取り込み範囲の指定(開始行)")
    If startRowStr = "" Then
        srcWb.Close SaveChanges:=False
        Exit Sub
    End If
    endRowStr = InputBox("職員の氏名が並んでいる最後の行番号を入力してください。" & vbCrLf & _
                          "(集計行や別グループの表が始まる手前までにしてください)", _
                          "取り込み範囲の指定(終了行)")
    If endRowStr = "" Then
        srcWb.Close SaveChanges:=False
        Exit Sub
    End If
    If Not IsNumeric(startRowStr) Or Not IsNumeric(endRowStr) Then
        MsgBox "行番号は数字で入力してください。", vbExclamation
        srcWb.Close SaveChanges:=False
        Exit Sub
    End If

    Dim startRow As Long, endRow As Long
    startRow = CLng(startRowStr)
    endRow = CLng(endRowStr)
    If endRow < startRow Then
        MsgBox "終了行は開始行以降にしてください。", vbExclamation
        srcWb.Close SaveChanges:=False
        Exit Sub
    End If

    Dim wasProtected As Boolean
    wasProtected = UnprotectIfNeeded(destWs)

    Dim importedNames As String
    Dim importedCount As Long
    Dim r As Long, dd As Long
    For r = startRow To endRow
        Dim rawName As String
        rawName = CStr(srcWs.Cells(r, nameCol).Value)
        Dim cleanName As String
        cleanName = NormalizeName(rawName)

        If cleanName <> "" And Not IsNumeric(cleanName) Then
            Dim destRow As Long
            destRow = FindOrCreateShiftRow(destWs, cleanName)

            For dd = 1 To 31
                Dim srcCol As Long
                srcCol = firstDayCol + (dd - 1)
                Dim destCol As Long
                destCol = FindShiftDayColumn(destWs, dd)
                If destCol > 0 Then
                    Dim v As Variant
                    v = srcWs.Cells(r, srcCol).Value
                    If Not IsEmpty(v) Then
                        destWs.Cells(destRow, destCol).Value = CStr(v)
                    End If
                End If
            Next dd

            importedCount = importedCount + 1
            importedNames = importedNames & cleanName & vbCrLf
        End If
    Next r

    ReprotectIfNeeded destWs, wasProtected

    srcWb.Close SaveChanges:=False

    If importedCount = 0 Then
        MsgBox "指定した範囲から取り込める職員名が見つかりませんでした。行番号を確認してください。", vbExclamation
        Exit Sub
    End If

    MsgBox "取り込みが完了しました。(" & destWs.Name & " へ " & importedCount & "名分)" & vbCrLf & vbCrLf & _
           "必ず取り込んだ内容を目視で確認してください。" & vbCrLf & vbCrLf & importedNames, vbInformation

    ThisWorkbook.Save
End Sub

' シートの中から「1,2,3,4,...」と20個以上連続する日付ヘッダーの行を探し、
' 「1」が入っている列を返す(見つからなければ0)。headerRowにはその行番号を返す。
Private Function DetectFirstDayColumn(ByVal ws As Worksheet, ByRef headerRow As Long) As Long
    Const MAX_SCAN_ROW As Long = 30
    Const MAX_SCAN_COL As Long = 70
    Const MIN_RUN As Long = 20

    Dim r As Long, c As Long, k As Long
    For r = 1 To MAX_SCAN_ROW
        For c = 1 To MAX_SCAN_COL
            If IsNumeric(ws.Cells(r, c).Value) Then
                If CLng(ws.Cells(r, c).Value) = 1 Then
                    Dim ok As Boolean
                    ok = True
                    For k = 1 To MIN_RUN - 1
                        If Not IsNumeric(ws.Cells(r, c + k).Value) Then
                            ok = False
                            Exit For
                        End If
                        If CLng(ws.Cells(r, c + k).Value) <> k + 1 Then
                            ok = False
                            Exit For
                        End If
                    Next k
                    If ok Then
                        headerRow = r
                        DetectFirstDayColumn = c
                        Exit Function
                    End If
                End If
            End If
        Next c
    Next r
    headerRow = 0
    DetectFirstDayColumn = 0
End Function

' 氏名の桁揃え用に入っている半角・全角スペースを取り除き、比較しやすい形にする。
Private Function NormalizeName(ByVal rawName As String) As String
    Dim s As String
    s = CStr(rawName)
    s = Replace(s, " ", "")
    s = Replace(s, Chr(12288), "")
    s = Trim$(s)
    NormalizeName = s
End Function

Private Function FindOrCreateShiftRow(ByVal ws As Worksheet, ByVal staffName As String) As Long
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    Dim r As Long
    For r = 5 To lastRow
        If Trim$(CStr(ws.Cells(r, 1).Value)) = Trim$(staffName) Then
            FindOrCreateShiftRow = r
            Exit Function
        End If
    Next r
    Dim newRow As Long
    newRow = lastRow + 1
    If newRow < 5 Then newRow = 5
    ws.Cells(newRow, 1).Value = staffName
    FindOrCreateShiftRow = newRow
End Function
